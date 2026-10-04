import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from backend.app import QueryOptions, detect_default_resolver, extract_records, query


class QueryOptionsTests(unittest.TestCase):
    def valid_options(self, **changes):
        values = {
            "name": "example.com",
            "type": "A",
            "dnsClass": "IN",
            "server": "1.1.1.1",
        }
        values.update(changes)
        return QueryOptions(**values)

    def test_normalizes_dns_name_and_type(self):
        options = self.valid_options(name="Exämple.org", type="aaaa")
        self.assertEqual(options.name, "xn--exmple-cua.org.")
        self.assertEqual(options.type, "AAAA")

    def test_accepts_ipv4_and_ipv6_names_for_reverse_queries(self):
        self.assertEqual(self.valid_options(name="20.40.137.160", type="PTR").name, "20.40.137.160")
        self.assertEqual(self.valid_options(name="2001:4860:4860::8888", type="PTR").name, "2001:4860:4860::8888")

    def test_accepts_private_record_type_codes(self):
        self.assertEqual(self.valid_options(type="type65400").type, "TYPE65400")
        with self.assertRaises(ValidationError):
            self.valid_options(type="TYPE65536")

    def test_environment_dns_override_takes_precedence(self):
        with patch.dict(os.environ, {"DEFAULT_DNS_SERVER": "8.8.4.4"}):
            with patch("backend.app.subprocess.run") as run:
                self.assertEqual(detect_default_resolver(), "8.8.4.4")
                run.assert_not_called()

    def test_extracts_cname_target(self):
        output = ";; ANSWER SECTION:\nwww.example.com. 300 IN CNAME example.com.\n\n;; AUTHORITY SECTION:\nexample.com. 1800 IN SOA ns.example.com. hostmaster.example.com. 1 3600 600 604800 1800\n"
        records = extract_records(output)
        self.assertEqual(records[0]["type"], "CNAME")
        self.assertEqual(records[0]["value"], "example.com.")

    def test_rejects_shell_syntax_in_expert_options(self):
        with self.assertRaises(ValidationError):
            self.valid_options(advancedOptions="+nsid; whoami")

    def test_rejects_invalid_nameserver(self):
        with self.assertRaises(ValidationError):
            self.valid_options(server="1.1.1.1; whoami")

    def test_builds_argument_vector_and_extracts_answer(self):
        options = self.valid_options(
            name="example.com",
            dnsClass="IN",
            server="2001:4860:4860::8888",
            dnssec=True,
            tcp=True,
            checkingDisabled=True,
            advancedOptions="+nsid +bufsize=1232",
            port=5353,
        )
        completed = SimpleNamespace(
            stdout=";; ANSWER SECTION:\nexample.com. 300 IN A 93.184.216.34\n\n;; Query time: 2 msec\n",
            stderr="",
            returncode=0,
        )
        with patch("backend.app.DIG", sys.executable), patch("backend.app.subprocess.run", return_value=completed) as run:
            result = query(options)

        command = run.call_args.args[0]
        self.assertIn("@2001:4860:4860::8888", command)
        self.assertIn("+dnssec", command)
        self.assertIn("+tcp", command)
        self.assertIn("+cdflag", command)
        self.assertEqual(command[-2:], ["+nsid", "+bufsize=1232"])
        self.assertNotIn("shell", run.call_args.kwargs)
        self.assertEqual(result["records"][0]["value"], "93.184.216.34")

    def test_extracts_short_ptr_answer_into_records(self):
        options = self.valid_options(
            name="4.4.8.8.in-addr.arpa",
            type="PTR",
            short=True,
        )
        completed = SimpleNamespace(stdout="dns.google.\n", stderr="", returncode=0)
        with patch("backend.app.DIG", sys.executable), patch("backend.app.subprocess.run", return_value=completed):
            result = query(options)

        self.assertEqual(result["records"], [{
            "name": "4.4.8.8.in-addr.arpa.",
            "ttl": "",
            "dnsClass": "IN",
            "type": "PTR",
            "value": "dns.google.",
        }])

    def test_uses_dig_reverse_lookup_for_ip_ptr_query(self):
        options = self.valid_options(name="20.40.137.160", type="PTR")
        completed = SimpleNamespace(
            stdout=";; ANSWER SECTION:\n160.137.40.20.in-addr.arpa. 300 IN PTR host.example.\n",
            stderr="",
            returncode=0,
        )
        with patch("backend.app.DIG", sys.executable), patch("backend.app.subprocess.run", return_value=completed) as run:
            result = query(options)

        command = run.call_args.args[0]
        self.assertIn("-x", command)
        self.assertIn("20.40.137.160", command)
        self.assertEqual(result["records"][0]["value"], "host.example.")


if __name__ == "__main__":
    unittest.main()
