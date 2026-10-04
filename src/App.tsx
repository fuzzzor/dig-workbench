import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Globe2,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  TerminalSquare,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import { optionDocSectionsEn, translations, type Language } from './i18n'
import './workbench.css'

type QueryOptions = {
  name: string
  type: string
  dnsClass: string
  advancedOptions: string
  server: string
  dnssec: boolean
  tcp: boolean
  trace: boolean
  short: boolean
  recursion: boolean
  checkingDisabled: boolean
  timeout: number
  retries: number
  port: number
}

type QueryResult = {
  command: string[]
  output: string
  exitCode: number
  durationMs: number
  records: { name: string; ttl: string; dnsClass: string; type: string; value: string }[]
}

type HistoryEntry = { options: QueryOptions; timestamp: number; durationMs: number }

const defaults: QueryOptions = {
  name: 'example.com',
  type: 'A',
  dnsClass: 'IN',
  advancedOptions: '',
  server: '',
  dnssec: false,
  tcp: false,
  trace: false,
  short: false,
  recursion: true,
  checkingDisabled: false,
  timeout: 5,
  retries: 2,
  port: 53,
}

const isIpAddress = (value: string) => {
  const address = value.trim().replace(/^\[|\]$/g, '')
  const octets = address.split('.')
  if (octets.length === 4 && octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) return true
  try {
    new URL(`http://[${address}]/`)
    return true
  } catch {
    return false
  }
}

const recordTypes = [
  'A', 'AAAA', 'CAA', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'MX', 'NS', 'PTR',
  'SOA', 'SRV', 'SSHFP', 'SVCB', 'TLSA', 'TXT', 'ANY',
]

const serverPresets = [
  { label: 'Cloudflare', address: '1.1.1.1', note: '1.0.0.1' },
  { label: 'Google', address: '8.8.8.8', note: '8.8.4.4' },
  { label: 'Quad9', address: '9.9.9.9', note: '149.112.112.112' },
  { label: 'OpenDNS', address: '208.67.222.222', note: '208.67.220.220' },
]

const optionDocSections = [
  {
    title: 'Nom, type et serveur',
    description: 'La cible de la question DNS et le serveur qui la reçoit.',
    options: [
      { flag: 'NOM', syntax: 'example.com', description: 'Nom de domaine à interroger. Ajoute un point final si tu veux imposer un nom absolu.' },
      { flag: 'TYPE', syntax: 'A, AAAA, MX…', description: 'Type d’enregistrement demandé. Le menu couvre les types courants; AUTRE… accepte TYPE####.' },
      { flag: 'CLASSE', syntax: 'IN · CH · HS · ANY', description: 'Classe DNS. IN est la classe Internet habituelle; CH et HS servent à des espaces historiques ou spécifiques.' },
      { flag: '@serveur', syntax: '@1.1.1.1', description: 'Serveur DNS interrogé. Dans le champ personnalisé, IPv4, IPv6 et noms d’hôte sont acceptés.' },
      { flag: '-p', syntax: '-p 5353', description: 'Port DNS du serveur. Le port standard est 53; le champ Port permet de le modifier.' },
      { flag: 'DNS système', syntax: '127.0.0.11', description: 'Dans Docker Desktop, cette adresse est le relais DNS Docker vers le résolveur de l’hôte. Elle est détectée automatiquement et reste modifiable.' },
    ],
  },
  {
    title: 'Transport et résolution',
    description: 'Contrôle du transport, de la récursion et du chemin de résolution.',
    options: [
      { flag: '+tcp', syntax: '+tcp', description: 'Force TCP au lieu d’UDP. Utile pour les réponses volumineuses, les transferts ou le diagnostic d’un filtrage UDP.' },
      { flag: '+notcp', syntax: '+notcp', description: 'Demande UDP, le transport par défaut de la plupart des requêtes DNS.' },
      { flag: '+recurse', syntax: '+recurse', description: 'Positionne le bit RD: demande au serveur de résoudre récursivement le nom. Activé par défaut dans l’interface.' },
      { flag: '+norecurse', syntax: '+norecurse', description: 'N’exige pas de résolution récursive. Pratique pour interroger directement un serveur faisant autorité.' },
      { flag: '+trace', syntax: '+trace', description: 'Suit la délégation DNS depuis les serveurs racine jusqu’à la zone cible. La résolution utilise alors sa propre chaîne de serveurs.' },
      { flag: '+dnssec', syntax: '+dnssec', description: 'Positionne le bit DO EDNS et demande les données DNSSEC. Cela demande les signatures; ce n’est pas à lui seul une validation cryptographique.' },
      { flag: '+nodnssec', syntax: '+nodnssec', description: 'Ne demande pas les enregistrements DNSSEC dans la réponse.' },
      { flag: '+cdflag', syntax: '+cdflag', description: 'Positionne CD (« checking disabled »): demande au résolveur de ne pas écarter les réponses selon sa validation DNSSEC.' },
      { flag: '+nocdflag', syntax: '+nocdflag', description: 'Retire le bit CD et laisse le comportement normal du résolveur.' },
      { flag: '+fail', syntax: '+fail', description: 'Avec +trace, arrête la chaîne lorsqu’un serveur fait autorité ne répond pas; ne bascule pas vers le serveur suivant.' },
      { flag: '+ignore', syntax: '+ignore', description: 'N’essaie pas TCP après une réponse UDP tronquée (bit TC).' },
      { flag: '+besteffort', syntax: '+besteffort', description: 'Essaie d’afficher les données DNSSEC mal formées au lieu d’abandonner leur décodage.' },
    ],
  },
  {
    title: 'Délai et tentatives',
    description: 'Limites de temps pour les serveurs qui répondent lentement ou pas du tout.',
    options: [
      { flag: '+time=N', syntax: '+time=5', description: 'Délai d’attente, en secondes, pour une réponse. Le champ Délai règle cette option; valeurs autorisées: 1 à 15.' },
      { flag: '+tries=N', syntax: '+tries=2', description: 'Nombre de tentatives par serveur avant abandon. Le champ Tentatives règle cette option; valeurs autorisées: 1 à 5.' },
    ],
  },
  {
    title: 'Format de sortie',
    description: 'Choix des sections et du niveau de détail produits par dig.',
    options: [
      { flag: '+short', syntax: '+short', description: 'Affiche une réponse compacte, généralement la valeur seule. À activer pour scripts et vérifications rapides.' },
      { flag: '+noshort', syntax: '+noshort', description: 'Conserve la sortie détaillée habituelle de dig.' },
      { flag: '+noall', syntax: '+noall', description: 'Masque toutes les sections; combine-le avec +answer, +stats ou d’autres sélecteurs pour ne réafficher que ce qui t’intéresse.' },
      { flag: '+answer', syntax: '+answer', description: 'Affiche la section ANSWER contenant les enregistrements correspondant à la question.' },
      { flag: '+authority', syntax: '+authority', description: 'Affiche la section AUTHORITY, utile pour examiner la délégation ou les serveurs faisant autorité.' },
      { flag: '+additional', syntax: '+additional', description: 'Affiche la section ADDITIONAL et les données complémentaires fournies par le serveur.' },
      { flag: '+question', syntax: '+question', description: 'Affiche la question envoyée au serveur DNS.' },
      { flag: '+comments', syntax: '+comments', description: 'Affiche les commentaires de réponse: statut, identifiant et indicateurs DNS.' },
      { flag: '+stats', syntax: '+stats', description: 'Affiche les statistiques de requête, dont le temps de réponse et la taille du message.' },
      { flag: '+multiline', syntax: '+multiline', description: 'Formate les enregistrements complexes sur plusieurs lignes pour faciliter leur lecture.' },
      { flag: '+ttlid', syntax: '+ttlid', description: 'Affiche les TTL dans la sortie, y compris en mode compact lorsque la version de dig le permet.' },
      { flag: '+identify', syntax: '+identify', description: 'Affiche l’adresse et le port du serveur qui a répondu.' },
      { flag: '+yaml', syntax: '+yaml', description: 'Demande une sortie structurée au format YAML, si cette version de dig la prend en charge.' },
      { flag: '+unknownformat', syntax: '+unknownformat', description: 'Affiche les types d’enregistrements inconnus sous forme de données brutes.' },
      { flag: '+nsid', syntax: '+nsid', description: 'Demande l’identifiant du serveur (EDNS NSID), s’il est configuré pour le communiquer.' },
      { flag: '+showsearch', syntax: '+showsearch', description: 'Affiche les noms essayés lorsque la liste de recherche DNS est utilisée.' },
      { flag: '+onesoa', syntax: '+onesoa', description: 'N’affiche qu’un SOA dans une réponse de transfert de zone.' },
    ],
  },
  {
    title: 'EDNS et réseau',
    description: 'Extensions DNS modernes et paramètres de transport avancés.',
    options: [
      { flag: '+edns[=N]', syntax: '+edns=0', description: 'Active EDNS et précise éventuellement sa version. EDNS permet notamment les réponses DNS plus grandes que 512 octets.' },
      { flag: '+noedns', syntax: '+noedns', description: 'Désactive EDNS pour cette requête.' },
      { flag: '+bufsize=N', syntax: '+bufsize=1232', description: 'Taille UDP annoncée dans l’option EDNS. 1232 octets est une valeur courante pour limiter la fragmentation.' },
      { flag: '+ednsflags=N', syntax: '+ednsflags=0', description: 'Définit les bits de drapeau EDNS envoyés avec la requête.' },
      { flag: '+cookie[=HEX]', syntax: '+cookie', description: 'Active l’option DNS Cookie et peut préciser une valeur hexadécimale selon la version de dig.' },
      { flag: '+nocookie', syntax: '+nocookie', description: 'Désactive l’envoi et l’affichage des DNS Cookies.' },
      { flag: '+subnet=IP/PREFIX', syntax: '+subnet=192.0.2.0/24', description: 'Envoie une option EDNS Client Subnet afin de demander une réponse adaptée à ce préfixe. Données transmises au résolveur.' },
      { flag: '+padding=N', syntax: '+padding=128', description: 'Ajoute du bourrage EDNS pour aligner la taille des requêtes, notamment pour les usages DNS chiffrés.' },
      { flag: '+keepalive', syntax: '+keepalive', description: 'Demande l’option EDNS TCP Keepalive lorsque le transport et le serveur la prennent en charge.' },
    ],
  },
]

const readHistory = (): HistoryEntry[] => {
  try {
    return JSON.parse(localStorage.getItem('dig-workbench-history') || '[]') as HistoryEntry[]
  } catch {
    return []
  }
}

const readLanguage = (): Language => {
  const browserLanguage = typeof navigator === 'undefined' ? '' : navigator.language
  return /^fr(?:[-_]|$)/i.test(browserLanguage) ? 'fr' : 'en'
}

function App() {
  const [language, setLanguage] = useState<Language>(readLanguage)
  const [options, setOptions] = useState<QueryOptions>(defaults)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [showOptionDocs, setShowOptionDocs] = useState(false)
  const [optionDocsSearch, setOptionDocsSearch] = useState('')
  const [copied, setCopied] = useState<'result' | 'command' | null>(null)
  const [engineStatus, setEngineStatus] = useState<'checking' | 'ready' | 'missing' | 'offline'>('checking')
  const [defaultResolver, setDefaultResolver] = useState('')
  const serverTouched = useRef(false)
  const optionDocsSearchRef = useRef<HTMLInputElement>(null)
  const text = translations[language]
  const activeOptionDocSections = language === 'en' ? optionDocSectionsEn : optionDocSections

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage)
  }

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.ok ? response.json() as Promise<{ engine: string; defaultResolver: string | null }> : Promise.reject())
      .then((health) => {
        setEngineStatus(health.engine === 'dig' ? 'ready' : 'missing')
        if (health.defaultResolver) {
          setDefaultResolver(health.defaultResolver)
          setOptions((current) => serverTouched.current || current.server ? current : { ...current, server: health.defaultResolver! })
        }
      })
      .catch(() => setEngineStatus('offline'))
  }, [])

  useEffect(() => {
    if (!showOptionDocs) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    optionDocsSearchRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [showOptionDocs])

  const update = <K extends keyof QueryOptions>(key: K, value: QueryOptions[K]) => {
    if (key === 'server') serverTouched.current = true
    if (key === 'name' && typeof value === 'string' && isIpAddress(value)) {
      setOptions((current) => ({ ...current, name: value, type: 'PTR' }))
      return
    }
    setOptions((current) => ({ ...current, [key]: value }))
  }

  const ptrQuery = options.type === 'PTR'
  const reverseIpQuery = ptrQuery && isIpAddress(options.name)
  const commandPreview = [
    'dig', '-p', String(options.port), `+time=${options.timeout}`, `+tries=${options.retries}`,
    options.recursion ? '+recurse' : '+norecurse',
    ...(options.dnssec ? ['+dnssec'] : []),
    ...(options.tcp ? ['+tcp'] : []),
    ...(options.trace ? ['+trace'] : []),
    ...(options.short ? ['+short'] : []),
    ...(options.checkingDisabled ? ['+cdflag'] : []),
    `@${options.server || 'resolver'}`,
    ...(reverseIpQuery ? ['-x', options.name.trim().replace(/^\[|\]$/g, ''), '-c', options.dnsClass] : [options.name || 'domain', options.type, options.dnsClass]),
    ...options.advancedOptions.trim().split(/\s+/).filter(Boolean),
  ].join(' ')

  const searchTerm = optionDocsSearch.trim().toLowerCase()
  const visibleOptionDocSections = activeOptionDocSections
    .map((section) => ({
      ...section,
      options: section.options.filter((option) => `${option.flag} ${option.syntax} ${option.description}`.toLowerCase().includes(searchTerm)),
    }))
    .filter((section) => section.options.length > 0)

  const runQuery = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!options.server.trim()) {
      setError(text.noResolverError)
      return
    }
    setBusy(true)
    setError('')
    setShowRaw(false)
    setResult(null)
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
      const payload = await response.json() as QueryResult & { detail?: string }
      if (!response.ok) {
        const detail = payload.detail || text.queryFailed
        const localizedDetail = language === 'fr'
          ? detail
          : detail === 'Le binaire dig n’est pas disponible dans ce conteneur.'
            ? text.digUnavailable
            : detail === 'Délai maximal dépassé pendant la résolution DNS.'
              ? text.queryTimeout
              : detail.startsWith('Impossible de lancer dig : ')
                ? text.launchDigError(detail.slice('Impossible de lancer dig : '.length))
                : detail
        throw new Error(localizedDetail)
      }
      setResult(payload)
      const nextHistory = [{ options: { ...options }, timestamp: Date.now(), durationMs: payload.durationMs }, ...history]
        .filter((entry, index, entries) => entries.findIndex((item) => item.options.name === entry.options.name && item.options.type === entry.options.type && item.options.server === entry.options.server) === index)
        .slice(0, 6)
      setHistory(nextHistory)
      localStorage.setItem('dig-workbench-history', JSON.stringify(nextHistory))
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : text.networkError)
    } finally {
      setBusy(false)
    }
  }

  const copyText = async (text: string, target: 'result' | 'command') => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(target)
    window.setTimeout(() => setCopied(null), 1600)
  }

  const copyResult = () => {
    if (!result) return
    const columns = ptrQuery
      ? [text.name, text.ttl, text.class, text.type, text.hostname]
      : [text.name, text.ttl, text.class, text.type, text.value]
    const content = showRaw
      ? result.output
      : [
          columns.join('\t'),
          ...result.records.map((record) => [record.name, record.ttl, record.dnsClass, record.type, record.value].join('\t')),
        ].join('\n')
    void copyText(content, 'result')
  }

  const copyCommand = () => void copyText(commandPreview, 'command')

  const selectPreset = (address: string) => update('server', address)

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label={text.homeLabel}>
          <span className="brand-mark"><Activity size={19} strokeWidth={2.5} /></span>
          <span>DIG<span className="brand-light"> / WORKBENCH</span></span>
        </a>
        <div className="topbar-right"><span className={`engine-status ${engineStatus}`}><span className="status-dot" /> {engineStatus === 'ready' ? text.engineReady : engineStatus === 'missing' ? text.digMissing : engineStatus === 'offline' ? text.apiOffline : text.checking}</span><span className="version-tag">v1.1</span><div className="language-switch" role="group" aria-label={text.selectLanguage}><button type="button" aria-label={text.languageEnglish} aria-pressed={language === 'en'} className={language === 'en' ? 'active' : ''} onClick={() => changeLanguage('en')}>EN</button><button type="button" aria-label={text.languageFrench} aria-pressed={language === 'fr'} className={language === 'fr' ? 'active' : ''} onClick={() => changeLanguage('fr')}>FR</button></div></div>
      </header>

      <main id="top" className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">{text.pageKicker}</p><h1>{text.heroStart}<em>{text.heroAccent}</em></h1><p className="intro">{text.intro}</p></div>
          <div className="heading-index"><span>01</span><span className="index-line" /><span>{text.requestIndex}</span></div>
        </div>

        <form className="query-bar" onSubmit={runQuery}>
          <label className="query-input-wrap"><span className="field-label">{text.domainName}</span><div className="domain-field"><Globe2 size={18} /><input aria-label={text.domainName} value={options.name} onChange={(event) => update('name', event.target.value)} placeholder={text.domainPlaceholder} spellCheck={false} /></div></label>
          <label className="type-select-wrap"><span className="field-label">{text.recordType}</span>{recordTypes.includes(options.type) ? <span className="select-wrap"><select aria-label={text.recordType} value={options.type} onChange={(event) => update('type', event.target.value === 'CUSTOM' ? 'TYPE65400' : event.target.value)}>{recordTypes.map((type) => <option key={type}>{type}</option>)}<option value="CUSTOM">{text.customTypeOption}</option></select><ChevronDown size={15} /></span> : <input className="custom-type-input" aria-label={text.customRecordType} value={options.type} onChange={(event) => update('type', event.target.value.toUpperCase())} spellCheck={false} />}</label>
          <label className="class-select-wrap"><span className="field-label">{text.recordClass}</span><span className="select-wrap"><select aria-label={text.recordClass} value={options.dnsClass} onChange={(event) => update('dnsClass', event.target.value)}>{['IN', 'CH', 'HS', 'ANY'].map((dnsClass) => <option key={dnsClass}>{dnsClass}</option>)}</select><ChevronDown size={14} /></span></label>
          <button className="run-button" type="submit" disabled={busy || !options.server}><span>{busy ? text.submitting : text.submit}</span>{busy ? <LoaderCircle className="spin" size={17} /> : <Play size={15} fill="currentColor" />}</button>
        </form>

        <div className="content-grid">
          <section className="primary-column" aria-label={text.primaryLabel}>
            <section className="panel resolver-panel">
              <div className="section-heading"><div className="section-icon"><Server size={16} /></div><div><h2>{text.resolverTitle}</h2><p>{text.resolverHelp}</p></div><span className="section-count">01 / 04</span></div>
              <div className="resolver-content">
                <div className="resolver-presets" role="group" aria-label={text.popularServers}>{serverPresets.map((preset) => <button key={preset.label} type="button" className={`preset ${options.server === preset.address ? 'selected' : ''}`} onClick={() => selectPreset(preset.address)}><span className="preset-radio" /><span className="preset-name">{preset.label}</span><span className="preset-address">{preset.address}</span></button>)}</div>
                <div className="custom-resolver"><label className="field-label" htmlFor="resolver">{options.server && options.server === defaultResolver ? text.defaultResolver : text.customResolver}</label><div className="resolver-input-row"><input id="resolver" value={options.server} onChange={(event) => update('server', event.target.value)} placeholder={engineStatus === 'checking' ? text.detectingResolver : text.resolverPlaceholder} spellCheck={false} /><span className="port-label">{text.portLabel}</span><input className="port-input" aria-label={text.portAria} type="number" min="1" max="65535" value={options.port} onChange={(event) => update('port', Number(event.target.value))} /></div><p className="field-hint">{defaultResolver ? text.defaultResolverHint(defaultResolver, defaultResolver === '127.0.0.11') : text.resolverHint}</p></div>
              </div>
            </section>

            <section className="panel options-panel">
              <div className="section-heading"><div className="section-icon orange"><Zap size={16} /></div><div><h2>{text.optionsTitle}</h2><p>{text.optionsHelp}<code>dig</code>.</p></div><span className="section-count">02 / 04</span></div>
              <div className="option-groups">
                <div className="toggle-grid">
                  <Toggle label="DNSSEC" detail={text.dnssecDetail} checked={options.dnssec} onChange={(value) => update('dnssec', value)} icon={<ShieldCheck size={16} />} />
                  <Toggle label="TCP" detail={text.tcpDetail} checked={options.tcp} onChange={(value) => update('tcp', value)} icon={<Wifi size={16} />} />
                  <Toggle label={text.traceLabel} detail={text.traceDetail} checked={options.trace} onChange={(value) => update('trace', value)} icon={<Activity size={16} />} />
                  <Toggle label={text.shortLabel} detail={text.shortDetail} checked={options.short} onChange={(value) => update('short', value)} icon={<TerminalSquare size={16} />} />
                </div>
                <div className="option-footer">
                  <label className="check-option"><input type="checkbox" checked={options.recursion} onChange={(event) => update('recursion', event.target.checked)} /><span className="check-box" /><span><strong>{text.recursionLabel}</strong><small>{text.recursionDetail}</small></span></label>
                  <label className="check-option"><input type="checkbox" checked={options.checkingDisabled} onChange={(event) => update('checkingDisabled', event.target.checked)} /><span className="check-box" /><span><strong>{text.cdLabel}</strong><small>{text.cdDetail}</small></span></label>
                  <label className="numeric-option"><span className="field-label">{text.timeout}</span><input type="number" min="1" max="15" value={options.timeout} onChange={(event) => update('timeout', Number(event.target.value))} /></label>
                  <label className="numeric-option"><span className="field-label">{text.attempts}</span><input type="number" min="1" max="5" value={options.retries} onChange={(event) => update('retries', Number(event.target.value))} /></label>
                </div>
                <label className="advanced-options"><span className="field-label">{text.expertOptions}</span><input value={options.advancedOptions} onChange={(event) => update('advancedOptions', event.target.value)} placeholder={text.expertPlaceholder} spellCheck={false} /><small>{text.expertHint}</small></label>
                <button className="docs-trigger" type="button" onClick={() => setShowOptionDocs(true)} aria-haspopup="dialog" aria-expanded={showOptionDocs}><BookOpen size={15} /><span>{text.docsButton}</span><span className="docs-trigger-count">{activeOptionDocSections.reduce((count, section) => count + section.options.length, 0)} {text.optionCount}</span></button>
              </div>
            </section>

            <section className="results-section" aria-live="polite" aria-label={text.resultTitle}>
              <div className="results-heading"><div className="results-title"><span className="result-kicker">03 / 04</span><h2>{text.resultTitle}</h2>{result && <span className={`result-pill ${result.exitCode === 0 ? 'success' : 'warning'}`}><span />{result.exitCode === 0 ? text.responseReceived : `CODE ${result.exitCode}`}</span>}</div>{result && <div className="result-actions"><span className="duration"><Clock3 size={13} />{result.durationMs} ms</span><button className="icon-button" title={showRaw ? text.copyRaw : text.copyRecords} aria-label={showRaw ? text.copyRaw : text.copyRecords} disabled={showRaw ? !result.output : result.records.length === 0} onClick={copyResult} type="button">{copied === 'result' ? <Check size={15} /> : <Copy size={15} />}</button><button className="icon-button" title={text.newQuery} aria-label={text.newQuery} onClick={() => { setResult(null); setError('') }} type="button"><RotateCcw size={15} /></button></div>}</div>
              {error && <div className="error-banner"><X size={16} /><span>{error}</span></div>}
              {!result && !busy && !error && <div className="empty-results"><span className="empty-cross">+</span><p>{text.readyForQuery(options.server)}</p><span>{text.responseAppears}</span></div>}
              {busy && <div className="loading-results"><LoaderCircle className="spin" size={20} /><span>{text.querying(options.server)}</span></div>}
              {result && <div className="result-body">
                <div className="result-tabs"><button type="button" className={!showRaw ? 'active' : ''} onClick={() => setShowRaw(false)}>{text.recordsTab} <span>{result.records.length}</span></button><button type="button" className={showRaw ? 'active' : ''} onClick={() => setShowRaw(true)}>{text.rawTab}</button></div>
                {showRaw ? <pre className="raw-output">{result.output || (language === 'en' ? 'No output.' : 'Aucune sortie.')}</pre> : result.records.length > 0 ? <div className="records-table-wrap"><table className="records-table"><thead><tr>{ptrQuery ? <><th>{text.name}</th><th>{text.ttl}</th><th>{text.class}</th><th>{text.type}</th><th>{text.hostname}</th></> : <><th>{text.name}</th><th>{text.ttl}</th><th>{text.class}</th><th>{text.type}</th><th>{text.value}</th></>}</tr></thead><tbody>{result.records.map((record, index) => <tr key={`${record.name}-${index}`}><td>{record.name}</td><td>{record.ttl}</td><td>{record.dnsClass}</td><td><span className="type-tag">{record.type}</span></td><td className="record-value">{record.value}</td></tr>)}</tbody></table></div> : <div className="no-records"><span>∅</span>{options.type === 'CNAME' ? <><p>{text.noCname(options.name)}</p><small>{text.cnameNote}</small></> : <p>{text.noRecords(options.type)}</p>}<button type="button" onClick={() => setShowRaw(true)}>{text.viewFullOutput} <ArrowDownToLine size={13} /></button></div>}
              </div>}
            </section>
          </section>

          <aside className="side-column">
            <section className="panel history-panel"><div className="aside-heading"><div className="section-icon"><History size={16} /></div><div><h2>{text.recentQueries}</h2><p>{text.recentHelp}</p></div></div>{history.length ? <div className="history-list">{history.map((entry, index) => <button type="button" className="history-entry" key={`${entry.timestamp}-${index}`} onClick={() => { setOptions(entry.options); setError('') }}><span className="history-type">{entry.options.type}</span><span className="history-details"><strong>{entry.options.name}</strong><small>@ {entry.options.server}</small></span><span className="history-time">{entry.durationMs}ms</span></button>)}</div> : <div className="history-empty"><Clock3 size={15} /><span>{text.recentEmpty}</span></div>}</section>
            <section className="terminal-card"><div className="terminal-top"><span className="terminal-lights"><i /><i /><i /></span><span>{text.commandPreview}</span><button className="preview-copy" type="button" onClick={copyCommand} title={text.copyCommand} aria-label={text.copyCommand}>{copied === 'command' ? <Check size={14} /> : <Copy size={14} />}</button></div><div className="terminal-command"><span className="prompt-mark">$</span><code>{commandPreview}</code></div><div className="terminal-foot"><span><span className="status-dot" /> {text.validatedArguments}</span></div></section>
            <div className="tip-panel"><span className="tip-line" /><div><span className="tip-label">{text.tipTitle}</span><p>{text.traceTip}</p></div></div>
            <div className="aside-footer"><span>DIG WORKBENCH</span><span>04 / 04 <span className="footer-line" /> {text.done}</span></div>
          </aside>
        </div>
        <footer className="page-footer"><span>{text.footerLabel} <span>·</span> FuzZzor 2026</span><span>{text.footerNote}</span></footer>
      </main>
      {showOptionDocs && <div className="docs-scrim" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') setShowOptionDocs(false) }} onMouseDown={(event) => { if (event.target === event.currentTarget) setShowOptionDocs(false) }}>
        <aside className="docs-drawer" role="dialog" aria-modal="true" aria-labelledby="docs-title">
          <header className="docs-header"><div className="docs-heading-icon"><BookOpen size={18} /></div><div className="docs-heading-copy"><span className="docs-eyebrow">{text.docsEyebrow}</span><h2 id="docs-title">{text.docsTitle}</h2><p>{text.docsSubtitle}</p></div><button className="docs-close" type="button" onClick={() => setShowOptionDocs(false)} aria-label={text.closeDocs}><X size={18} /></button></header>
          <div className="docs-search"><Search size={16} /><input ref={optionDocsSearchRef} type="search" value={optionDocsSearch} onChange={(event) => setOptionDocsSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setShowOptionDocs(false) }} placeholder={text.searchPlaceholder} aria-label={text.searchLabel} /><kbd>ESC</kbd></div>
          <div className="docs-content">
            {visibleOptionDocSections.length === 0 && <div className="docs-no-results">{text.noOptionMatch(optionDocsSearch)}</div>}
            {visibleOptionDocSections.map((section, sectionIndex) => <section className="docs-section" key={section.title}><div className="docs-section-heading"><span>{String(sectionIndex + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><p>{section.description}</p></div></div><div className="docs-option-list">{section.options.map((option) => <article className="docs-option" key={option.flag}><div className="docs-option-top"><code>{option.flag}</code><span>{option.syntax}</span></div><p>{option.description}</p></article>)}</div></section>)}
            <div className="docs-note"><strong>{text.expertNoteTitle}</strong><p>{text.expertNote}<code>dig</code>{text.expertNoteEnd}</p></div>
          </div>
          <footer className="docs-footer"><span>{text.integratedGuide}</span><button type="button" onClick={() => setShowOptionDocs(false)}>{text.close} <X size={13} /></button></footer>
        </aside>
      </div>}
    </div>
  )
}

function Toggle({ label, detail, checked, onChange, icon }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void; icon: React.ReactNode }) {
  return <label className={`toggle-option ${checked ? 'is-on' : ''}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-icon">{icon}</span><span className="toggle-copy"><strong>{label}</strong><small>{detail}</small></span><span className="switch"><i /></span></label>
}

export default App
