import ipaddress
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parent
if not (ROOT / "dist").is_dir():
    ROOT = ROOT.parent
DIG = shutil.which("dig") or "/usr/bin/dig"
RECORD_TYPES = {
    "A", "AAAA", "CAA", "CNAME", "DNSKEY", "DS", "HTTPS", "MX", "NS",
    "PTR", "SOA", "SRV", "SSHFP", "SVCB", "TLSA", "TXT", "ANY",
}


def normalize_server(value: str) -> str:
    server = value.strip().strip("[]")
    if not server or server.startswith("-") or any(char in server for char in "@/\\#"):
        raise ValueError("Serveur DNS invalide.")
    try:
        return str(ipaddress.ip_address(server))
    except ValueError:
        pass
    if len(server) > 253:
        raise ValueError("Nom de serveur DNS trop long.")
    try:
        labels = [label.encode("idna").decode("ascii") for label in server.rstrip(".").split(".")]
    except UnicodeError:
        raise ValueError("Nom de serveur DNS invalide.") from None
    if not labels or any(not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in labels):
        raise ValueError("Serveur DNS invalide. Saisissez une adresse IP ou un nom d’hôte.")
    return ".".join(labels)


class QueryOptions(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=253)
    type: str = Field(default="A", min_length=1, max_length=16)
    dns_class: Literal["IN", "CH", "HS", "ANY"] = Field(default="IN", alias="dnsClass")
    advanced_options: str = Field(default="", max_length=512, alias="advancedOptions")
    server: str = Field(min_length=1, max_length=253)
    dnssec: bool = False
    tcp: bool = False
    trace: bool = False
    short: bool = False
    recursion: bool = True
    checking_disabled: bool = Field(default=False, alias="checkingDisabled")
    timeout: int = Field(default=5, ge=1, le=15)
    retries: int = Field(default=2, ge=1, le=5)
    port: int = Field(default=53, ge=1, le=65535)

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        normalized = value.upper()
        type_code = re.fullmatch(r"TYPE([0-9]{1,5})", normalized)
        if normalized not in RECORD_TYPES and (not type_code or int(type_code.group(1)) > 65535):
            raise ValueError("Type d’enregistrement DNS non pris en charge.")
        return normalized

    @field_validator("advanced_options")
    @classmethod
    def validate_advanced_options(cls, value: str) -> str:
        tokens = value.split()
        option_pattern = re.compile(r"\+(?:no)?[A-Za-z][A-Za-z0-9]*(?:=[A-Za-z0-9_.:,/-]+)?")
        if len(tokens) > 24 or any(not option_pattern.fullmatch(token) for token in tokens):
            raise ValueError("Les options expertes doivent être des options dig +... valides.")
        return " ".join(tokens)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        name = value.strip().rstrip(".")
        if not name:
            return "."
        try:
            return str(ipaddress.ip_address(name.strip("[]")))
        except ValueError:
            pass
        if len(name) > 253 or any(not label for label in name.split(".")):
            raise ValueError("Nom DNS invalide.")
        labels = []
        try:
            for label in name.split("."):
                if label == "*":
                    labels.append(label)
                elif "_" in label:
                    if not re.fullmatch(r"[A-Za-z0-9_-]{1,63}", label):
                        raise ValueError
                    labels.append(label)
                else:
                    encoded = label.encode("idna").decode("ascii")
                    if len(encoded) > 63 or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?", encoded):
                        raise ValueError
                    labels.append(encoded)
        except (UnicodeError, ValueError):
            raise ValueError("Nom DNS invalide. Vérifiez les labels ou utilisez une forme punycode pour les IDN.") from None
        return ".".join(labels) + "."

    @field_validator("server")
    @classmethod
    def validate_server(cls, value: str) -> str:
        try:
            return normalize_server(value)
        except ValueError as error:
            raise ValueError(str(error)) from None


app = FastAPI(title="Dig Workbench API", docs_url=None, redoc_url=None)


def detect_default_resolver() -> str | None:
    configured = os.getenv("DEFAULT_DNS_SERVER", "").strip()
    if configured:
        try:
            return normalize_server(configured)
        except ValueError:
            pass

    if os.name == "nt":
        command = (
            "Get-NetIPConfiguration | "
            "Where-Object { $_.IPv4DefaultGateway -or $_.IPv6DefaultGateway } | "
            "ForEach-Object { $_.DNSServer.ServerAddresses } | Select-Object -First 1"
        )
        try:
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True,
                text=True,
                check=False,
                timeout=3,
            )
            for candidate in result.stdout.splitlines():
                try:
                    return str(ipaddress.ip_address(candidate.strip()))
                except ValueError:
                    continue
        except (OSError, subprocess.TimeoutExpired):
            return None
        return None

    try:
        resolver_config = Path("/etc/resolv.conf").read_text(encoding="utf-8")
    except OSError:
        return None
    for line in resolver_config.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] == "nameserver":
            try:
                return str(ipaddress.ip_address(fields[1]))
            except ValueError:
                continue
    return None


@app.get("/api/health")
def health() -> dict[str, str | None]:
    return {
        "status": "ok",
        "engine": "dig" if shutil.which("dig") else "missing",
        "defaultResolver": detect_default_resolver(),
    }


def extract_records(
    output: str,
    *,
    short_output: str | None = None,
    name: str = "",
    record_type: str = "",
    dns_class: str = "IN",
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    in_answer = False
    for line in output.splitlines():
        if line.strip() == ";; ANSWER SECTION:":
            in_answer = True
            continue
        if line.startswith(";;"):
            in_answer = False
        if in_answer and line.strip():
            fields = line.split(maxsplit=4)
            if len(fields) == 5:
                records.append({
                    "name": fields[0],
                    "ttl": fields[1],
                    "dnsClass": fields[2],
                    "type": fields[3],
                    "value": fields[4],
                })
    if records or short_output is None:
        return records
    return [
        {
            "name": name,
            "ttl": "",
            "dnsClass": dns_class,
            "type": record_type,
            "value": line.strip(),
        }
        for line in short_output.splitlines()
        if line.strip()
    ]


@app.post("/api/query")
def query(options: QueryOptions) -> dict[str, object]:
    if not Path(DIG).is_file():
        raise HTTPException(status_code=503, detail="Le binaire dig n’est pas disponible dans ce conteneur.")

    command = [
        DIG,
        "-p", str(options.port),
        f"+time={options.timeout}",
        f"+tries={options.retries}",
        "+recurse" if options.recursion else "+norecurse",
    ]
    if options.dnssec:
        command.append("+dnssec")
    if options.tcp:
        command.append("+tcp")
    if options.trace:
        command.append("+trace")
    if options.short:
        command.append("+short")
    if options.checking_disabled:
        command.append("+cdflag")
    reverse_address = None
    if options.type == "PTR":
        try:
            reverse_address = ipaddress.ip_address(options.name.strip("[]"))
        except ValueError:
            pass
    query_name = f"{reverse_address.reverse_pointer}." if reverse_address else options.name
    command.append(f"@{options.server}")
    if reverse_address:
        command.extend(["-x", str(reverse_address), "-c", options.dns_class])
    else:
        command.extend([options.name, options.type, options.dns_class])
    command.extend(options.advanced_options.split())

    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=min(60, options.timeout * options.retries + (30 if options.trace else 5)),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Délai maximal dépassé pendant la résolution DNS.") from None
    except OSError as error:
        raise HTTPException(status_code=502, detail=f"Impossible de lancer dig : {error}") from None

    duration_ms = round((time.perf_counter() - started) * 1000)
    output = completed.stdout + completed.stderr
    return {
        "command": command,
        "output": output,
        "exitCode": completed.returncode,
        "durationMs": duration_ms,
        "records": extract_records(
            output,
            short_output=completed.stdout if options.short else None,
            name=query_name,
            record_type=options.type,
            dns_class=options.dns_class,
        ),
    }


if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
