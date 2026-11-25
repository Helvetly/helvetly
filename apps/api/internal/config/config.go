// Package config reads the process configuration from the environment and validates it.
package config

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"net/mail"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/aimodel"
)

type Config struct {
	Addr            string
	ShutdownTimeout time.Duration
	DatabaseURL     string
	// PublicURL is the platform origin the browser sees (no trailing slash).
	PublicURL string
	// PortalURL is the client portal's origin (no trailing slash): its own host, served by the same binary.
	PortalURL string
	// DocsURL is the developer docs' origin (DOCS_URL): its API playground may call the public catalogue with a
	// bearer token (CORS, no credentials). Empty = no cross-origin access.
	DocsURL string
	// MediaURL is the origin downloads are redirected to (MEDIA_URL), signed links under /api/media/ served by this
	// binary on another host. Empty = presigned or proxied downloads (S3_PROXY_DOWNLOADS).
	MediaURL string
	// APIURL is the origin bearer clients and agents are told to use (PUBLIC_API_URL), e.g. https://api.helvetly.com, the
	// same binary on its own host. Empty = PUBLIC_URL serves them too.
	APIURL string
	// SecretKey seals the Google sign-in cookie and keys the client-address HMAC (32 bytes).
	SecretKey []byte
	// DevSecretKey: SECRET_KEY was empty and a fixed development key is in use.
	DevSecretKey       bool
	GoogleClientID     string
	GoogleClientSecret string
	SMTP               SMTP
	SessionTTL         time.Duration
	CookieSecure       bool
	// TrustedProxies: reverse proxies whose X-Forwarded-For names the client (TRUSTED_PROXY_CIDRS); none = the TCP peer.
	TrustedProxies []netip.Prefix
	S3             S3
	// DocumentsMaxUpload: the largest file Documents accepts, in bytes (DOCUMENTS_MAX_UPLOAD_MB).
	DocumentsMaxUpload int64
	// DevSignIn exposes sign-in codes at /api/v1/auth/email/dev-code (development and tests only).
	DevSignIn bool
	Stripe    Stripe
	// KSeFAPI: the Polish KSeF 2.0 API root (KSEF_API_URL), e.g. https://api-test.ksef.mf.gov.pl/v2; empty = off.
	KSeFAPI string
	// UIDRegisterURL: the Swiss UID register's public SOAP service (UID_REGISTER_URL), for the client form's company
	// lookup; the federal production endpoint by default, "off" = no lookups.
	UIDRegisterURL string
	// AddressSuggestURL: the Photon API behind the location fields' address suggestions (ADDRESS_SUGGEST_URL); the
	// public instance by default, "off" = none.
	AddressSuggestURL string
	AI                AI
	// FeedbackEmail receives Help & feedback reports (FEEDBACK_EMAIL); empty = reports are stored only.
	FeedbackEmail       string
	TelegramBotToken    string
	TelegramAdminChatID int64
	// GoogleAnalyticsID: the GA4 measurement id of the platform's page views (GOOGLE_ANALYTICS_ID, G-...); empty = off,
	// so an installation sends nothing to Google unless its operator sets it.
	GoogleAnalyticsID string
	// CustomDomains: workspaces' own portal hosts through Cloudflare for SaaS; off when its settings are empty.
	CustomDomains CustomDomains
	// Calendars: members' Google and Microsoft calendar sync (Scheduling); each provider off without its client.
	Calendars Calendars
}

// Calendars are the OAuth clients of calendar sync. Google's is its own Google Cloud client, never the sign-in one
// (calendar scopes need Google's verification, which must not touch sign-in). Secrets are never logged.
type Calendars struct {
	GoogleClientID     string // GOOGLE_CALENDAR_CLIENT_ID
	GoogleClientSecret string // GOOGLE_CALENDAR_CLIENT_SECRET
	MicrosoftClientID  string // MICROSOFT_CLIENT_ID
	MicrosoftSecret    string // MICROSOFT_CLIENT_SECRET
	MicrosoftTenant    string // MICROSOFT_TENANT: common (work, school and personal accounts) by default
	// GoogleAPIURL and MicrosoftGraphURL replace every endpoint of a provider (sign-in, token and API) with one root:
	// tests only (GOOGLE_CALENDAR_API_URL, MICROSOFT_GRAPH_URL). Empty = the providers' own.
	GoogleAPIURL      string
	MicrosoftGraphURL string
	// Fake (HELVETLY_E2E_FAKE_CALENDARS) serves fake Google and Microsoft APIs from this binary and connects to them:
	// end-to-end tests only.
	Fake bool
}

func (c Calendars) Google() bool    { return c.GoogleClientID != "" }
func (c Calendars) Microsoft() bool { return c.MicrosoftClientID != "" }

// CustomDomains are the Cloudflare for SaaS custom hostnames a workspace's portal may be served on (portal.firma.ch):
// the zone they are added to and the CNAME target its customers point at. The token is never logged.
type CustomDomains struct {
	APIToken string // CLOUDFLARE_API_TOKEN: SSL and Certificates edit on the zone only
	ZoneID   string // CLOUDFLARE_ZONE_ID
	Target   string // CUSTOM_DOMAIN_TARGET, a hostname such as portal.helvetly.com
	APIURL   string // CLOUDFLARE_API_URL: https://api.cloudflare.com/client/v4, or a fake in tests
	// Fake (HELVETLY_E2E_FAKE_DOMAINS) finds every ownership TXT record: end-to-end tests, which have no public DNS.
	Fake bool
}

// Enabled reports whether workspaces may add their own portal domain.
func (c CustomDomains) Enabled() bool { return c.APIToken != "" }

// AI is the model behind Heidi and the AI import; opt-in. No key means Heidi's factual local commands only. The monthly
// token allowances are plan limits (ai_tokens_per_month for Heidi, ai_automation_tokens_per_month for AI import and
// filing), not settings.
type AI struct {
	OpenAIKey string
	// OpenAIBaseURL is the OpenAI-compatible API root (OPENAI_BASE_URL), e.g. https://api.openai.com/v1.
	OpenAIBaseURL string
	// Model is one of aimodel.Cards: every call is priced by its rate card before it is made.
	Model string
	// FallbackModel (OPENAI_FALLBACK_MODEL, "" = none) is another of aimodel.Cards, asked once when Model is still
	// overloaded after its retries.
	FallbackModel string
	// FakeImportModel reads import files with aimodel.Fake instead of OpenAI (HELVETLY_E2E_FAKE_AI, set by the
	// end-to-end server): refused unless AUTH_DEV_SIGNIN is on a local origin.
	FakeImportModel bool
}

// Stripe: subscription billing (docs/billing-contract.md); off when SecretKey is empty, and then no plan limit applies.
type Stripe struct {
	SecretKey string
	// WebhookSecret (STRIPE_WEBHOOK_SECRET) is one signing secret, or several separated by commas only while rotating
	// it: an event signed with any of them is taken. The endpoint's API version needs none (handlers read objects again).
	WebhookSecret string
	// AutomaticTax turns on Stripe Tax in Checkout (Swiss VAT taken out of VAT-inclusive prices).
	AutomaticTax bool
	// ManagedPayments (STRIPE_MANAGED_PAYMENTS) sends Checkout through Stripe Managed Payments: Stripe (through Link)
	// is the merchant of record and handles tax, the customer's invoices, fraud and disputes. The account must have
	// it enabled in the dashboard and the products need an eligible tax code (txcd_10103001, SaaS).
	ManagedPayments bool
	APIBase         string // https://api.stripe.com, or stripe-mock / a fake in tests
}

func (c Config) BillingEnabled() bool { return c.Stripe.SecretKey != "" }

// WebhookSecrets are the signing secrets in WebhookSecret, trimmed, empty ones left out.
func (s Stripe) WebhookSecrets() []string {
	var out []string
	for v := range strings.SplitSeq(s.WebhookSecret, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// S3: the object storage files go to: any service with the S3 API (README, "Object storage"). Nothing here names a
// provider; behaviour differs only by these settings.
type S3 struct {
	Endpoint  string // URL of the S3 API, scheme and host only, e.g. http://localhost:9300
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	// ObjectLockDays > 0 keeps booked receipts and issued invoice PDFs undeletable for that many days (S3 Object
	// Lock, GeBüV); 0 is off. The bucket must have Object Lock enabled.
	ObjectLockDays int
	ObjectLockMode string // GOVERNANCE or COMPLIANCE
	// VirtualHosted addresses the bucket as <bucket>.<endpoint host> (S3_ADDRESSING=virtual) instead of
	// <endpoint>/<bucket> (path, the default), for a service that only accepts one of them.
	VirtualHosted bool
	// ProxyDownloads streams downloads through the API instead of redirecting to a presigned URL, for a bucket the
	// browser cannot reach (the dev tunnel, where S3_ENDPOINT is localhost).
	ProxyDownloads bool
}

type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	TLS      string // starttls, tls or none
	From     string
}

// EmailSignIn: sign-in codes can reach people (by mail, or by the dev-code endpoint).
func (c Config) EmailSignIn() bool { return c.MailConfigured() || c.DevSignIn }

// MailConfigured: the server can send mail.
func (c Config) MailConfigured() bool { return c.SMTP.Host != "" && c.SMTP.From != "" }

func (c Config) GoogleSignIn() bool { return c.GoogleClientID != "" }

// gaID is a GA4 measurement id (GOOGLE_ANALYTICS_ID).
var gaID = regexp.MustCompile(`^G-[A-Z0-9]{4,20}$`)

var (
	zoneID     = regexp.MustCompile(`^[0-9a-f]{32}$`)
	tenant     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$`)
	targetHost = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
)

func Load() (Config, error) {
	var errs []error
	fail := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	boolean := func(key string, fallback bool) bool {
		v := env(key, "")
		if v == "" {
			return fallback
		}
		b, err := strconv.ParseBool(v)
		if err != nil {
			fail("%s must be true or false, got %q", key, v)
		}
		return b
	}

	c := Config{
		Addr:               env("HTTP_ADDR", ":3333"),
		ShutdownTimeout:    15 * time.Second,
		DatabaseURL:        env("DATABASE_URL", "postgres://helvetly:helvetly@localhost:5433/helvetly?sslmode=disable"),
		PublicURL:          env("PUBLIC_URL", "http://localhost:8000"),
		PortalURL:          env("PORTAL_URL", "http://localhost:8002"),
		GoogleClientID:     env("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: env("GOOGLE_CLIENT_SECRET", ""),
		SMTP: SMTP{
			Host:     env("SMTP_HOST", ""),
			Username: env("SMTP_USERNAME", ""),
			Password: env("SMTP_PASSWORD", ""),
			TLS:      env("SMTP_TLS", "none"),
			From:     env("MAIL_FROM", "Helvetly <no-reply@helvetly.local>"),
		},
		S3: S3{
			Endpoint:       env("S3_ENDPOINT", "http://localhost:9300"),
			Region:         env("S3_REGION", "us-east-1"),
			Bucket:         env("S3_BUCKET", "helvetly"),
			AccessKey:      env("S3_ACCESS_KEY", ""),
			SecretKey:      env("S3_SECRET_KEY", ""),
			ObjectLockMode: env("S3_OBJECT_LOCK_MODE", "COMPLIANCE"),
			ProxyDownloads: boolean("S3_PROXY_DOWNLOADS", false),
		},
		DevSignIn: boolean("AUTH_DEV_SIGNIN", false),
		AI: AI{OpenAIKey: env("OPENAI_API_KEY", ""), OpenAIBaseURL: strings.TrimSuffix(env("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/"),
			Model: env("OPENAI_MODEL", aimodel.DefaultModel), FallbackModel: env("OPENAI_FALLBACK_MODEL", ""),
			FakeImportModel: boolean("HELVETLY_E2E_FAKE_AI", false)},
		FeedbackEmail:     env("FEEDBACK_EMAIL", ""),
		GoogleAnalyticsID: env("GOOGLE_ANALYTICS_ID", ""),
	}
	c.TelegramBotToken = env("TELEGRAM_BOT_TOKEN", "")
	chatID := env("TELEGRAM_ADMIN_CHAT_ID", "")
	if (c.TelegramBotToken == "") != (chatID == "") {
		fail("TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID must be set together")
	}
	if c.TelegramBotToken != "" {
		if ok, _ := regexp.MatchString(`^[0-9]+:[A-Za-z0-9_-]+$`, c.TelegramBotToken); !ok {
			fail("TELEGRAM_BOT_TOKEN has an invalid format")
		}
		id, err := strconv.ParseInt(chatID, 10, 64)
		if err != nil || id <= 0 {
			fail("TELEGRAM_ADMIN_CHAT_ID must be the numeric ID of a private chat")
		}
		c.TelegramAdminChatID = id
	}
	if c.FeedbackEmail != "" {
		if a, err := mail.ParseAddress(c.FeedbackEmail); err != nil || a.Name != "" {
			fail("FEEDBACK_EMAIL must be one plain address such as feedback@helvetly.com, got %q", c.FeedbackEmail)
		}
	}
	for old, now := range map[string]string{"HEIDI_OPENAI_API_KEY": "OPENAI_API_KEY", "HEIDI_OPENAI_MODEL": "OPENAI_MODEL",
		"HEIDI_MONTHLY_TOKENS": "the plan limit ai_tokens_per_month", "AI_FAKE_PROVIDER": "HELVETLY_E2E_FAKE_AI"} {
		if os.Getenv(old) != "" { // a renamed setting must not be dropped silently
			fail("%s is no longer read: use %s", old, now)
		}
	}
	if c.GoogleAnalyticsID != "" && !gaID.MatchString(c.GoogleAnalyticsID) {
		fail("GOOGLE_ANALYTICS_ID must be a GA4 measurement id such as G-ABC123XYZ, got %q", c.GoogleAnalyticsID)
	}
	if strings.ContainsAny(c.AI.OpenAIKey, " \t\r\n") {
		fail("OPENAI_API_KEY must not contain whitespace")
	}
	if u, err := url.Parse(c.AI.OpenAIBaseURL); err != nil || u.Host == "" || u.RawQuery != "" || u.Fragment != "" ||
		(u.Scheme != "https" && (u.Scheme != "http" || !localHost(u.Hostname()))) {
		fail("OPENAI_BASE_URL must be an https URL such as https://api.openai.com/v1 (http only on a local host), got %q", c.AI.OpenAIBaseURL)
	}
	if _, ok := aimodel.Cards[c.AI.Model]; !ok {
		fail("OPENAI_MODEL must be a model Helvetly has a rate card for (%s), got %q", strings.Join(slices.Sorted(maps.Keys(aimodel.Cards)), ", "), c.AI.Model)
	}
	if _, ok := aimodel.Cards[c.AI.FallbackModel]; c.AI.FallbackModel != "" && (!ok || c.AI.FallbackModel == c.AI.Model) {
		fail("OPENAI_FALLBACK_MODEL must be empty or another model than OPENAI_MODEL with a rate card (%s), got %q",
			strings.Join(slices.Sorted(maps.Keys(aimodel.Cards)), ", "), c.AI.FallbackModel)
	}

	u, err := url.Parse(c.PublicURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") ||
		u.RawQuery != "" || u.Fragment != "" {
		fail("PUBLIC_URL must be an origin such as https://app.helvetly.com, got %q", c.PublicURL)
	} else {
		c.PublicURL = u.Scheme + "://" + u.Host
	}
	p, err := url.Parse(c.PortalURL)
	switch {
	case err != nil || (p.Scheme != "http" && p.Scheme != "https") || p.Host == "" || (p.Path != "" && p.Path != "/") ||
		p.RawQuery != "" || p.Fragment != "":
		fail("PORTAL_URL must be an origin such as https://portal.helvetly.com, got %q", c.PortalURL)
		p = nil
	case u != nil && strings.EqualFold(p.Host, u.Host):
		fail("PORTAL_URL must be on another host than PUBLIC_URL, got %q for both", p.Host)
	case u != nil && !localHost(u.Hostname()) && localHost(p.Hostname()):
		fail("PORTAL_URL is required with a public PUBLIC_URL; it is still the local %q", c.PortalURL)
	default:
		c.PortalURL = p.Scheme + "://" + p.Host
	}
	// The docs' playground: on by default only next to a local platform (pnpm dev); a public deployment names it.
	docsDefault := ""
	if u != nil && localHost(u.Hostname()) {
		docsDefault = "http://localhost:8003"
	}
	if c.DocsURL = env("DOCS_URL", docsDefault); c.DocsURL != "" {
		d, err := url.Parse(c.DocsURL)
		switch {
		case err != nil || (d.Scheme != "http" && d.Scheme != "https") || d.Host == "" || (d.Path != "" && d.Path != "/") ||
			d.RawQuery != "" || d.Fragment != "" || d.User != nil:
			fail("DOCS_URL must be an origin such as https://docs.helvetly.com, got %q", c.DocsURL)
		case u != nil && !localHost(u.Hostname()) && (d.Scheme != "https" || localHost(d.Hostname())):
			fail("DOCS_URL must be a public https origin with a public PUBLIC_URL, got %q", c.DocsURL)
		default:
			c.DocsURL = d.Scheme + "://" + strings.ToLower(d.Host)
		}
	}
	if c.MediaURL = env("MEDIA_URL", ""); c.MediaURL != "" {
		m, err := url.Parse(c.MediaURL)
		switch {
		case err != nil || (m.Scheme != "http" && m.Scheme != "https") || m.Host == "" || (m.Path != "" && m.Path != "/") ||
			m.RawQuery != "" || m.Fragment != "" || m.User != nil:
			fail("MEDIA_URL must be an origin such as https://media.helvetly.com, got %q", c.MediaURL)
		case (u != nil && strings.EqualFold(m.Host, u.Host)) || (p != nil && strings.EqualFold(m.Host, p.Host)):
			fail("MEDIA_URL must be on another host than PUBLIC_URL and PORTAL_URL, got %q", m.Host)
		case !localHost(m.Hostname()) && m.Scheme != "https":
			fail("MEDIA_URL must be https on a public host, got %q", c.MediaURL)
		default:
			c.MediaURL = m.Scheme + "://" + strings.ToLower(m.Host)
		}
	}
	if c.APIURL = env("PUBLIC_API_URL", ""); c.APIURL != "" {
		a, err := url.Parse(c.APIURL)
		switch {
		case err != nil || (a.Scheme != "http" && a.Scheme != "https") || a.Host == "" || (a.Path != "" && a.Path != "/") ||
			a.RawQuery != "" || a.Fragment != "" || a.User != nil:
			fail("PUBLIC_API_URL must be an origin such as https://api.helvetly.com, got %q", c.APIURL)
		case (u != nil && strings.EqualFold(a.Host, u.Host)) || (p != nil && strings.EqualFold(a.Host, p.Host)):
			fail("PUBLIC_API_URL must be on another host than PUBLIC_URL and PORTAL_URL, got %q", a.Host)
		case !localHost(a.Hostname()) && a.Scheme != "https":
			fail("PUBLIC_API_URL must be https on a public host, got %q", c.APIURL)
		default:
			c.APIURL = a.Scheme + "://" + strings.ToLower(a.Host)
		}
	}
	c.CookieSecure = boolean("COOKIE_SECURE", u != nil && u.Scheme == "https")
	// Session cookies must never travel in clear text where real users sign in.
	if u != nil && !localHost(u.Hostname()) {
		if u.Scheme != "https" {
			fail("PUBLIC_URL must be https on a public host, got %q", c.PublicURL)
		} else if !c.CookieSecure {
			fail("COOKIE_SECURE=false is for local development only; PUBLIC_URL %q is https", c.PublicURL)
		}
	}
	if p != nil && !localHost(p.Hostname()) && p.Scheme != "https" {
		fail("PORTAL_URL must be https on a public host, got %q", c.PortalURL)
	}
	// Dev sign-in hands out anyone's sign-in code: refuse it on an origin real users could reach.
	if c.DevSignIn && u != nil && !localHost(u.Hostname()) {
		fail("AUTH_DEV_SIGNIN is for local development only; PUBLIC_URL %q is not a local origin", c.PublicURL)
	}
	if c.DevSignIn && p != nil && !localHost(p.Hostname()) {
		fail("AUTH_DEV_SIGNIN is for local development only; PORTAL_URL %q is not a local origin", c.PortalURL)
	}
	if c.AI.FakeImportModel && !c.DevSignIn {
		fail("HELVETLY_E2E_FAKE_AI is for tests and local development only: it needs AUTH_DEV_SIGNIN on a local origin")
	}

	switch key := env("SECRET_KEY", ""); {
	case key == "" && c.DevSignIn:
		sum := sha256.Sum256([]byte("helvetly development secret key"))
		c.SecretKey, c.DevSecretKey = sum[:], true
	case key == "":
		fail("SECRET_KEY is required: generate one with `openssl rand -base64 32`")
	default:
		c.SecretKey, err = base64.StdEncoding.DecodeString(key)
		if err != nil || len(c.SecretKey) != 32 {
			fail("SECRET_KEY must be 32 bytes in base64 (`openssl rand -base64 32`)")
		}
	}

	if (c.GoogleClientID == "") != (c.GoogleClientSecret == "") {
		fail("set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither")
	}

	if c.SMTP.Port, err = strconv.Atoi(env("SMTP_PORT", "1025")); err != nil || c.SMTP.Port < 1 || c.SMTP.Port > 65535 {
		fail("SMTP_PORT must be a port number, got %q", env("SMTP_PORT", ""))
	}
	if c.SMTP.TLS != "starttls" && c.SMTP.TLS != "tls" && c.SMTP.TLS != "none" {
		fail("SMTP_TLS must be starttls, tls or none, got %q", c.SMTP.TLS)
	}
	if c.SMTP.From != "" {
		if _, err := mail.ParseAddress(c.SMTP.From); err != nil {
			fail("MAIL_FROM must be an address such as \"Helvetly <no-reply@helvetly.com>\", got %q", c.SMTP.From)
		}
	}

	if s3, err := url.Parse(c.S3.Endpoint); err != nil || (s3.Scheme != "http" && s3.Scheme != "https") || s3.Host == "" {
		fail("S3_ENDPOINT must be a URL such as http://localhost:9300, got %q", c.S3.Endpoint)
	}
	if s3, err := url.Parse(c.S3.Endpoint); err == nil && (s3.User != nil || strings.Trim(s3.Path, "/") != "" || s3.RawQuery != "") {
		fail("S3_ENDPOINT takes only a scheme and host (no credentials, path or query): the bucket is S3_BUCKET")
	}
	if c.S3.Bucket == "" || c.S3.Region == "" {
		fail("S3_BUCKET and S3_REGION are required")
	}
	if c.S3.AccessKey == "" || c.S3.SecretKey == "" {
		fail("S3_ACCESS_KEY and S3_SECRET_KEY are required")
	}
	switch env("S3_ADDRESSING", "path") {
	case "path":
	case "virtual":
		c.S3.VirtualHosted = true
	default:
		fail("S3_ADDRESSING must be path or virtual, got %q", env("S3_ADDRESSING", ""))
	}
	if c.S3.ObjectLockDays, err = strconv.Atoi(env("S3_OBJECT_LOCK_DAYS", "0")); err != nil || c.S3.ObjectLockDays < 0 ||
		c.S3.ObjectLockDays > 36500 {
		fail("S3_OBJECT_LOCK_DAYS must be a number of days from 0 (off) to 36500, got %q", env("S3_OBJECT_LOCK_DAYS", ""))
	}
	if c.S3.ObjectLockMode != "GOVERNANCE" && c.S3.ObjectLockMode != "COMPLIANCE" {
		fail("S3_OBJECT_LOCK_MODE must be GOVERNANCE or COMPLIANCE, got %q", c.S3.ObjectLockMode)
	}

	if mb, err := strconv.Atoi(env("DOCUMENTS_MAX_UPLOAD_MB", "25")); err != nil || mb < 1 || mb > 25 {
		// 25 MB is the largest file any upload entry point takes.
		fail("DOCUMENTS_MAX_UPLOAD_MB must be a whole number of megabytes from 1 to 25, got %q", env("DOCUMENTS_MAX_UPLOAD_MB", ""))
	} else {
		c.DocumentsMaxUpload = int64(mb) << 20
	}

	c.Stripe = Stripe{SecretKey: env("STRIPE_SECRET_KEY", ""), WebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
		AutomaticTax: boolean("STRIPE_AUTOMATIC_TAX", true), ManagedPayments: boolean("STRIPE_MANAGED_PAYMENTS", false), APIBase: env("STRIPE_API_BASE", "https://api.stripe.com")}
	if c.Stripe.SecretKey != "" {
		if !strings.HasPrefix(c.Stripe.SecretKey, "sk_") && !strings.HasPrefix(c.Stripe.SecretKey, "rk_") {
			fail("STRIPE_SECRET_KEY must be a Stripe secret or restricted key (sk_… or rk_…)")
		}
		secrets := c.Stripe.WebhookSecrets()
		if len(secrets) == 0 || slices.ContainsFunc(secrets, func(v string) bool { return !strings.HasPrefix(v, "whsec_") }) {
			fail("STRIPE_WEBHOOK_SECRET is required with STRIPE_SECRET_KEY (whsec_…, from `docker compose logs stripe` or the dashboard; several separated by commas)")
		}
		if u, err := url.Parse(c.Stripe.APIBase); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			fail("STRIPE_API_BASE must be a URL such as https://api.stripe.com, got %q", c.Stripe.APIBase)
		}
	}

	for _, v := range strings.Split(env("TRUSTED_PROXY_CIDRS", ""), ",") {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		if v == "cloudflare" {
			c.TrustedProxies = append(c.TrustedProxies, CloudflareIPs...)
			continue
		}
		p, err := netip.ParsePrefix(v)
		if err != nil {
			addr, aerr := netip.ParseAddr(v)
			if aerr != nil {
				fail("TRUSTED_PROXY_CIDRS must be comma-separated CIDRs, addresses or cloudflare, such as 10.0.0.0/8,cloudflare, got %q", v)
				continue
			}
			p = netip.PrefixFrom(addr.Unmap(), addr.Unmap().BitLen())
		}
		c.TrustedProxies = append(c.TrustedProxies, p.Masked())
	}

	c.CustomDomains = CustomDomains{APIToken: env("CLOUDFLARE_API_TOKEN", ""), ZoneID: env("CLOUDFLARE_ZONE_ID", ""),
		Target: strings.ToLower(strings.TrimSuffix(env("CUSTOM_DOMAIN_TARGET", ""), ".")),
		APIURL: strings.TrimSuffix(env("CLOUDFLARE_API_URL", "https://api.cloudflare.com/client/v4"), "/"),
		Fake:   boolean("HELVETLY_E2E_FAKE_DOMAINS", false)}
	if cd := c.CustomDomains; cd.APIToken != "" || cd.ZoneID != "" || cd.Target != "" {
		switch {
		case cd.APIToken == "" || cd.ZoneID == "" || cd.Target == "":
			fail("CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID and CUSTOM_DOMAIN_TARGET are all needed for custom portal domains, or none")
		case strings.ContainsAny(cd.APIToken, " \t\r\n"):
			fail("CLOUDFLARE_API_TOKEN must not contain whitespace")
		case !zoneID.MatchString(cd.ZoneID):
			fail("CLOUDFLARE_ZONE_ID must be the zone's 32-character id, got %q", cd.ZoneID)
		case !targetHost.MatchString(cd.Target):
			fail("CUSTOM_DOMAIN_TARGET must be a hostname such as portal.helvetly.com, got %q", cd.Target)
		}
		if u, err := url.Parse(cd.APIURL); err != nil || u.Host == "" || (u.Scheme != "https" && (u.Scheme != "http" || !localHost(u.Hostname()))) {
			fail("CLOUDFLARE_API_URL must be an https URL such as https://api.cloudflare.com/client/v4 (http only on a local host), got %q", cd.APIURL)
		}
	}
	c.Calendars = Calendars{GoogleClientID: env("GOOGLE_CALENDAR_CLIENT_ID", ""), GoogleClientSecret: env("GOOGLE_CALENDAR_CLIENT_SECRET", ""),
		MicrosoftClientID: env("MICROSOFT_CLIENT_ID", ""), MicrosoftSecret: env("MICROSOFT_CLIENT_SECRET", ""),
		MicrosoftTenant: env("MICROSOFT_TENANT", "common"), GoogleAPIURL: strings.TrimSuffix(env("GOOGLE_CALENDAR_API_URL", ""), "/"),
		MicrosoftGraphURL: strings.TrimSuffix(env("MICROSOFT_GRAPH_URL", ""), "/"), Fake: boolean("HELVETLY_E2E_FAKE_CALENDARS", false)}
	if cc := c.Calendars; (cc.GoogleClientID == "") != (cc.GoogleClientSecret == "") {
		fail("GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET: set both or neither")
	}
	if cc := c.Calendars; (cc.MicrosoftClientID == "") != (cc.MicrosoftSecret == "") {
		fail("MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET: set both or neither")
	}
	if !tenant.MatchString(c.Calendars.MicrosoftTenant) {
		fail("MICROSOFT_TENANT must be common, organizations, consumers, a tenant id or a domain, got %q", c.Calendars.MicrosoftTenant)
	}
	for key, v := range map[string]string{"GOOGLE_CALENDAR_API_URL": c.Calendars.GoogleAPIURL, "MICROSOFT_GRAPH_URL": c.Calendars.MicrosoftGraphURL} {
		if u, err := url.Parse(v); v != "" && (err != nil || u.Host == "" || (u.Scheme != "https" && (u.Scheme != "http" || !localHost(u.Hostname())))) {
			fail("%s must be an https URL (http only on a local host), got %q", key, v)
		}
	}
	if c.Calendars.Fake && !c.DevSignIn {
		fail("HELVETLY_E2E_FAKE_CALENDARS is for tests only: it needs AUTH_DEV_SIGNIN on a local origin")
	}
	if c.CustomDomains.Fake && !c.DevSignIn {
		fail("HELVETLY_E2E_FAKE_DOMAINS is for tests only: it needs AUTH_DEV_SIGNIN on a local origin")
	}

	if c.KSeFAPI = env("KSEF_API_URL", ""); c.KSeFAPI != "" {
		if u, err := url.Parse(c.KSeFAPI); err != nil || u.Scheme != "https" || u.Host == "" {
			fail("KSEF_API_URL must be an https URL such as https://api-test.ksef.mf.gov.pl/v2, got %q", c.KSeFAPI)
		}
	}

	if c.UIDRegisterURL = env("UID_REGISTER_URL", "https://www.uid-wse.admin.ch/V5.0/PublicServices.svc"); c.UIDRegisterURL == "off" {
		c.UIDRegisterURL = ""
	} else if u, err := url.Parse(c.UIDRegisterURL); err != nil || u.Host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && localHost(u.Hostname()))) {
		fail("UID_REGISTER_URL must be an https URL such as https://www.uid-wse.admin.ch/V5.0/PublicServices.svc, or off, got %q", c.UIDRegisterURL)
	}

	if c.AddressSuggestURL = env("ADDRESS_SUGGEST_URL", "https://photon.komoot.io/api/"); c.AddressSuggestURL == "off" {
		c.AddressSuggestURL = ""
	} else if u, err := url.Parse(c.AddressSuggestURL); err != nil || u.Host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && localHost(u.Hostname()))) {
		fail("ADDRESS_SUGGEST_URL must be an https URL such as https://photon.komoot.io/api/, or off, got %q", c.AddressSuggestURL)
	}

	if c.SessionTTL, err = time.ParseDuration(env("SESSION_TTL", "720h")); err != nil || c.SessionTTL <= 0 {
		fail("SESSION_TTL must be a positive duration such as 720h, got %q", env("SESSION_TTL", ""))
	}
	return c, errors.Join(errs...)
}

// env treats an empty value like an unset one, so `KEY=` in .env means "use the default".
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// localHost is a machine-local or reserved test name (RFC 6761), never a public deployment.
func localHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1" ||
		strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".test")
}

// CloudflareIPs are Cloudflare's published edge ranges (https://www.cloudflare.com/ips-v4 and ips-v6, read
// 2026-11-15). TRUSTED_PROXY_CIDRS=cloudflare stands for them; auth.ForwardedFor believes CF-IPCountry only from them.
// shortcut: a fixed copy; update it when Cloudflare announces new ranges (rare, with notice).
var CloudflareIPs = func() []netip.Prefix {
	var out []netip.Prefix
	for _, s := range []string{
		"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
		"190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
		"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
		"2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29",
		"2c0f:f248::/32",
	} {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}()
