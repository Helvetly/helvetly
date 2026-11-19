package config

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	key := "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=" // 32 bytes
	for _, tc := range []struct {
		name  string
		env   map[string]string
		err   string
		check func(Config) bool
	}{
		{"dev defaults", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool {
			return c.DevSecretKey && len(c.SecretKey) == 32 && c.PublicURL == "http://localhost:8000" && c.PortalURL == "http://localhost:8002" && !c.CookieSecure &&
				c.SessionTTL == 720*time.Hour && c.SMTP.Port == 1025 && c.SMTP.TLS == "none" && c.S3.Endpoint == "http://localhost:9300" && c.S3.Region == "us-east-1" && c.S3.Bucket == "helvetly" && c.DocumentsMaxUpload == 25<<20 && c.S3.ObjectLockDays == 0 && c.S3.ObjectLockMode == "COMPLIANCE" && c.EmailSignIn() && !c.MailConfigured() && !c.GoogleSignIn()
		}},
		{"production", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com/", "PORTAL_URL": "https://portal.helvetly.com/", "SMTP_HOST": "smtp.example.com",
			"GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": "secret"}, "", func(c Config) bool {
			return !c.DevSecretKey && c.PublicURL == "https://app.helvetly.com" && c.PortalURL == "https://portal.helvetly.com" && c.CookieSecure && c.MailConfigured() && c.GoogleSignIn() && !c.DevSignIn
		}},
		{"no email sign-in", map[string]string{"SECRET_KEY": key}, "", func(c Config) bool { return !c.EmailSignIn() }},
		{"insecure cookies on a public https origin", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://x.example", "PORTAL_URL": "https://portal.x.example", "COOKIE_SECURE": "false"},
			"COOKIE_SECURE", nil},
		{"insecure cookies on a local origin", map[string]string{"SECRET_KEY": key, "COOKIE_SECURE": "false"}, "", func(c Config) bool { return !c.CookieSecure }},
		{"public origin over plain HTTP", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "http://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com"}, "PUBLIC_URL must be https", nil},
		{"public portal over plain HTTP", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "http://portal.helvetly.com"}, "PORTAL_URL must be https", nil},
		{"no secret key", nil, "SECRET_KEY is required", nil},
		{"dev sign-in on a public origin", map[string]string{"AUTH_DEV_SIGNIN": "true", "PUBLIC_URL": "https://app.helvetly.com"},
			"AUTH_DEV_SIGNIN", nil},
		{"dev sign-in on a .test origin", map[string]string{"AUTH_DEV_SIGNIN": "true", "PUBLIC_URL": "http://helvetly.test:8000"}, "",
			func(c Config) bool { return c.DevSignIn }},
		{"short secret key", map[string]string{"SECRET_KEY": "c2hvcnQ="}, "SECRET_KEY must be 32 bytes", nil},
		{"half of google", map[string]string{"AUTH_DEV_SIGNIN": "true", "GOOGLE_CLIENT_ID": "id"}, "GOOGLE_CLIENT_SECRET", nil},
		{"public url with a path", map[string]string{"AUTH_DEV_SIGNIN": "true", "PUBLIC_URL": "https://x.example/app"}, "PUBLIC_URL", nil},
		{"public url without a portal url", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com"}, "PORTAL_URL is required", nil},
		{"portal on the platform's host", map[string]string{"AUTH_DEV_SIGNIN": "true", "PORTAL_URL": "http://LOCALHOST:8000"}, "another host", nil},
		{"portal url with a path", map[string]string{"AUTH_DEV_SIGNIN": "true", "PORTAL_URL": "http://localhost:8002/portal"}, "PORTAL_URL must be an origin", nil},
		{"dev sign-in on a public portal", map[string]string{"AUTH_DEV_SIGNIN": "true", "PORTAL_URL": "https://portal.helvetly.com"}, "PORTAL_URL", nil},
		{"no s3 keys", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_ACCESS_KEY": "-"}, "S3_ACCESS_KEY and S3_SECRET_KEY are required", nil},
		{"bad s3 endpoint", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_ENDPOINT": "localhost:9300"}, "S3_ENDPOINT", nil},
		{"object lock", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_OBJECT_LOCK_DAYS": "3660", "S3_OBJECT_LOCK_MODE": "GOVERNANCE"}, "",
			func(c Config) bool { return c.S3.ObjectLockDays == 3660 && c.S3.ObjectLockMode == "GOVERNANCE" }},
		{"bad object lock days", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_OBJECT_LOCK_DAYS": "ten years"}, "S3_OBJECT_LOCK_DAYS", nil},
		{"bad object lock mode", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_OBJECT_LOCK_MODE": "legal"}, "S3_OBJECT_LOCK_MODE", nil},
		{"docs origin local by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool { return c.DocsURL == "http://localhost:8003" }},
		{"docs origin off by default in production", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com"}, "",
			func(c Config) bool { return c.DocsURL == "" }},
		{"docs origin", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "DOCS_URL": "https://Docs.helvetly.com/"}, "",
			func(c Config) bool { return c.DocsURL == "https://docs.helvetly.com" }},
		{"docs url with a path", map[string]string{"AUTH_DEV_SIGNIN": "true", "DOCS_URL": "http://localhost:8003/docs"}, "DOCS_URL must be an origin", nil},
		{"local docs url in production", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "DOCS_URL": "http://localhost:8003"}, "DOCS_URL must be a public https origin", nil},
		{"custom domains off by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool { return !c.CustomDomains.Enabled() }},
		{"custom domains", map[string]string{"AUTH_DEV_SIGNIN": "true", "CLOUDFLARE_API_TOKEN": "tok", "CLOUDFLARE_ZONE_ID": "0123456789abcdef0123456789abcdef",
			"CUSTOM_DOMAIN_TARGET": "Portal.helvetly.com."}, "", func(c Config) bool {
			return c.CustomDomains.Enabled() && c.CustomDomains.Target == "portal.helvetly.com" && c.CustomDomains.APIURL == "https://api.cloudflare.com/client/v4" && !c.CustomDomains.Fake
		}},
		{"half of custom domains", map[string]string{"AUTH_DEV_SIGNIN": "true", "CLOUDFLARE_API_TOKEN": "tok"}, "or none", nil},
		{"target alone", map[string]string{"AUTH_DEV_SIGNIN": "true", "CUSTOM_DOMAIN_TARGET": "portal.helvetly.com"}, "or none", nil},
		{"bad zone id", map[string]string{"AUTH_DEV_SIGNIN": "true", "CLOUDFLARE_API_TOKEN": "tok", "CLOUDFLARE_ZONE_ID": "helvetly.com",
			"CUSTOM_DOMAIN_TARGET": "portal.helvetly.com"}, "CLOUDFLARE_ZONE_ID", nil},
		{"token with whitespace", map[string]string{"AUTH_DEV_SIGNIN": "true", "CLOUDFLARE_API_TOKEN": "to k", "CLOUDFLARE_ZONE_ID": "0123456789abcdef0123456789abcdef",
			"CUSTOM_DOMAIN_TARGET": "portal.helvetly.com"}, "whitespace", nil},
		{"bad target", map[string]string{"AUTH_DEV_SIGNIN": "true", "CLOUDFLARE_API_TOKEN": "tok", "CLOUDFLARE_ZONE_ID": "0123456789abcdef0123456789abcdef",
			"CUSTOM_DOMAIN_TARGET": "https://portal.helvetly.com"}, "CUSTOM_DOMAIN_TARGET", nil},
		{"plain http cloudflare api", map[string]string{"AUTH_DEV_SIGNIN": "true", "CLOUDFLARE_API_TOKEN": "tok", "CLOUDFLARE_ZONE_ID": "0123456789abcdef0123456789abcdef",
			"CUSTOM_DOMAIN_TARGET": "portal.helvetly.com", "CLOUDFLARE_API_URL": "http://api.cloudflare.com"}, "CLOUDFLARE_API_URL", nil},
		{"fake domains need dev sign-in", map[string]string{"SECRET_KEY": key, "HELVETLY_E2E_FAKE_DOMAINS": "true"}, "HELVETLY_E2E_FAKE_DOMAINS", nil},
		{"media off by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool { return c.MediaURL == "" }},
		{"media origin", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "MEDIA_URL": "https://Media.helvetly.com/"}, "",
			func(c Config) bool { return c.MediaURL == "https://media.helvetly.com" }},
		{"local media origin over plain HTTP", map[string]string{"AUTH_DEV_SIGNIN": "true", "MEDIA_URL": "http://localhost:8004"}, "",
			func(c Config) bool { return c.MediaURL == "http://localhost:8004" }},
		{"public media origin over plain HTTP", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "MEDIA_URL": "http://media.helvetly.com"}, "MEDIA_URL must be https", nil},
		{"media url with a path", map[string]string{"AUTH_DEV_SIGNIN": "true", "MEDIA_URL": "http://localhost:8004/media"}, "MEDIA_URL must be an origin", nil},
		{"api origin", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "PUBLIC_API_URL": "https://API.helvetly.com/"}, "",
			func(c Config) bool { return c.APIURL == "https://api.helvetly.com" }},
		{"api origin on the platform's host", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "PUBLIC_API_URL": "https://app.helvetly.com"}, "PUBLIC_API_URL must be on another host", nil},
		{"public api origin over plain HTTP", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "PUBLIC_API_URL": "http://api.helvetly.com"}, "PUBLIC_API_URL must be https", nil},
		{"api url with a path", map[string]string{"AUTH_DEV_SIGNIN": "true", "PUBLIC_API_URL": "http://localhost:8005/api"}, "PUBLIC_API_URL must be an origin", nil},
		{"media on the platform's host", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "MEDIA_URL": "https://APP.helvetly.com"}, "MEDIA_URL must be on another host", nil},
		{"media on the portal's host", map[string]string{"SECRET_KEY": key, "PUBLIC_URL": "https://app.helvetly.com", "PORTAL_URL": "https://portal.helvetly.com", "MEDIA_URL": "https://portal.helvetly.com"}, "MEDIA_URL must be on another host", nil},
		{"proxy downloads", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_PROXY_DOWNLOADS": "true"}, "",
			func(c Config) bool { return c.S3.ProxyDownloads }},
		{"virtual-hosted addressing", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_ADDRESSING": "virtual"}, "",
			func(c Config) bool { return c.S3.VirtualHosted }},
		{"bad addressing", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_ADDRESSING": "dns"}, "S3_ADDRESSING", nil},
		{"endpoint with bucket path", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_ENDPOINT": "https://s3.example.test/helvetly"}, "scheme and host", nil},
		{"endpoint with credentials", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_ENDPOINT": "https://key:secret@s3.example.test"}, "scheme and host", nil},
		{"bad proxy downloads", map[string]string{"AUTH_DEV_SIGNIN": "true", "S3_PROXY_DOWNLOADS": "yes please"}, "S3_PROXY_DOWNLOADS", nil},
		{"bad upload limit", map[string]string{"AUTH_DEV_SIGNIN": "true", "DOCUMENTS_MAX_UPLOAD_MB": "0"}, "DOCUMENTS_MAX_UPLOAD_MB", nil},
		{"upload limit over the 25 MB file cap", map[string]string{"AUTH_DEV_SIGNIN": "true", "DOCUMENTS_MAX_UPLOAD_MB": "26"}, "from 1 to 25", nil},
		{"billing off by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool {
			return !c.BillingEnabled() && c.Stripe.AutomaticTax
		}},
		{"no AI model", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool {
			return c.AI.OpenAIKey == "" && c.AI.OpenAIBaseURL == "https://api.openai.com/v1" && c.AI.Model == "gpt-6-luna"
		}},
		{"OpenAI", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_API_KEY": "fake-test-key", "OPENAI_MODEL": "gpt-6.1-sol",
			"OPENAI_BASE_URL": "https://gateway.example/openai/v1/"}, "", func(c Config) bool {
			return c.AI.OpenAIKey == "fake-test-key" && c.AI.Model == "gpt-6.1-sol" && c.AI.OpenAIBaseURL == "https://gateway.example/openai/v1"
		}},
		{"local OpenAI-compatible server", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_BASE_URL": "http://localhost:11434/v1"}, "",
			func(c Config) bool { return c.AI.OpenAIBaseURL == "http://localhost:11434/v1" }},
		{"OpenAI base URL over plain HTTP", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_BASE_URL": "http://gateway.example/v1"}, "OPENAI_BASE_URL", nil},
		{"fake import model in development", map[string]string{"AUTH_DEV_SIGNIN": "true", "HELVETLY_E2E_FAKE_AI": "true"}, "", func(c Config) bool {
			return c.AI.FakeImportModel
		}},
		{"fake import model outside development", map[string]string{"SECRET_KEY": key, "HELVETLY_E2E_FAKE_AI": "true"}, "HELVETLY_E2E_FAKE_AI", nil},
		{"invalid OpenAI key", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_API_KEY": "fake\nkey"}, "OPENAI_API_KEY", nil},
		{"invalid model", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_MODEL": "invalid model"}, "OPENAI_MODEL", nil},
		{"model without a rate card", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_MODEL": "gpt-6-luna-fast"}, "OPENAI_MODEL", nil},
		{"fallback model", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_FALLBACK_MODEL": "gpt-6.1-sol"}, "",
			func(c Config) bool { return c.AI.Model == "gpt-6-luna" && c.AI.FallbackModel == "gpt-6.1-sol" }},
		{"no fallback model", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool { return c.AI.FallbackModel == "" }},
		{"fallback model without a rate card", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_FALLBACK_MODEL": "gpt-4-turbo"}, "OPENAI_FALLBACK_MODEL", nil},
		{"fallback model same as the model", map[string]string{"AUTH_DEV_SIGNIN": "true", "OPENAI_MODEL": "gpt-6.1-sol", "OPENAI_FALLBACK_MODEL": "gpt-6.1-sol"}, "OPENAI_FALLBACK_MODEL", nil},
		{"feedback email", map[string]string{"AUTH_DEV_SIGNIN": "true", "FEEDBACK_EMAIL": "team@helvetly.test"}, "", func(c Config) bool {
			return c.FeedbackEmail == "team@helvetly.test"
		}},
		{"invalid feedback email", map[string]string{"AUTH_DEV_SIGNIN": "true", "FEEDBACK_EMAIL": "Team <team@helvetly.test>"}, "FEEDBACK_EMAIL", nil},
		{"google analytics id", map[string]string{"AUTH_DEV_SIGNIN": "true", "GOOGLE_ANALYTICS_ID": "G-NMY4SN995C"}, "",
			func(c Config) bool { return c.GoogleAnalyticsID == "G-NMY4SN995C" }},
		{"invalid google analytics id", map[string]string{"AUTH_DEV_SIGNIN": "true", "GOOGLE_ANALYTICS_ID": "UA-12345-1"}, "GOOGLE_ANALYTICS_ID", nil},
		{"renamed Heidi key", map[string]string{"AUTH_DEV_SIGNIN": "true", "HEIDI_OPENAI_API_KEY": "old"}, "HEIDI_OPENAI_API_KEY is no longer read: use OPENAI_API_KEY", nil},
		{"token allowance is a plan limit", map[string]string{"AUTH_DEV_SIGNIN": "true", "HEIDI_MONTHLY_TOKENS": "25000"}, "ai_tokens_per_month", nil},
		{"billing", map[string]string{"AUTH_DEV_SIGNIN": "true", "STRIPE_SECRET_KEY": "sk_test_x", "STRIPE_WEBHOOK_SECRET": "whsec_x",
			"STRIPE_AUTOMATIC_TAX": "false"}, "", func(c Config) bool {
			return c.BillingEnabled() && !c.Stripe.AutomaticTax &&
				c.Stripe.APIBase == "https://api.stripe.com"
		}},
		{"billing needs the webhook secret", map[string]string{"AUTH_DEV_SIGNIN": "true", "STRIPE_SECRET_KEY": "sk_test_x"},
			"STRIPE_WEBHOOK_SECRET", nil},
		{"two webhook secrets while switching endpoints", map[string]string{"AUTH_DEV_SIGNIN": "true", "STRIPE_SECRET_KEY": "sk_test_x",
			"STRIPE_WEBHOOK_SECRET": "whsec_new, whsec_old,"}, "", func(c Config) bool {
			return slices.Equal(c.Stripe.WebhookSecrets(), []string{"whsec_new", "whsec_old"})
		}},
		{"every webhook secret is one", map[string]string{"AUTH_DEV_SIGNIN": "true", "STRIPE_SECRET_KEY": "sk_test_x",
			"STRIPE_WEBHOOK_SECRET": "whsec_new,sk_old"}, "STRIPE_WEBHOOK_SECRET", nil},
		{"billing needs a secret key", map[string]string{"AUTH_DEV_SIGNIN": "true", "STRIPE_SECRET_KEY": "pk_test_x"},
			"STRIPE_SECRET_KEY", nil},
		{"trusted proxies", map[string]string{"AUTH_DEV_SIGNIN": "true", "TRUSTED_PROXY_CIDRS": "10.0.0.0/8, 192.168.1.7,fd00::/8"}, "",
			func(c Config) bool {
				return len(c.TrustedProxies) == 3 && c.TrustedProxies[1].String() == "192.168.1.7/32" && c.TrustedProxies[2].String() == "fd00::/8"
			}},
		{"cloudflare stands for its edge ranges", map[string]string{"AUTH_DEV_SIGNIN": "true", "TRUSTED_PROXY_CIDRS": "172.18.0.2,cloudflare"}, "",
			func(c Config) bool {
				return len(c.TrustedProxies) == 1+len(CloudflareIPs) && c.TrustedProxies[0].String() == "172.18.0.2/32" &&
					c.TrustedProxies[1] == CloudflareIPs[0]
			}},
		{"no trusted proxies by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool { return c.TrustedProxies == nil }},
		{"bad trusted proxy", map[string]string{"AUTH_DEV_SIGNIN": "true", "TRUSTED_PROXY_CIDRS": "10.0.0.0/8,proxy.internal"}, "TRUSTED_PROXY_CIDRS", nil},
		{"KSeF off by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "", func(c Config) bool { return c.KSeFAPI == "" }},
		{"KSeF API", map[string]string{"AUTH_DEV_SIGNIN": "true", "KSEF_API_URL": "https://api-test.ksef.mf.gov.pl/v2"}, "",
			func(c Config) bool { return c.KSeFAPI == "https://api-test.ksef.mf.gov.pl/v2" }},
		{"KSeF API over plain HTTP", map[string]string{"AUTH_DEV_SIGNIN": "true", "KSEF_API_URL": "http://api-test.ksef.mf.gov.pl/v2"}, "KSEF_API_URL", nil},
		{"UID register on by default", map[string]string{"AUTH_DEV_SIGNIN": "true"}, "",
			func(c Config) bool { return c.UIDRegisterURL == "https://www.uid-wse.admin.ch/V5.0/PublicServices.svc" }},
		{"UID register off", map[string]string{"AUTH_DEV_SIGNIN": "true", "UID_REGISTER_URL": "off"}, "", func(c Config) bool { return c.UIDRegisterURL == "" }},
		{"UID register over plain HTTP", map[string]string{"AUTH_DEV_SIGNIN": "true", "UID_REGISTER_URL": "http://www.uid-wse.admin.ch/V5.0/PublicServices.svc"}, "UID_REGISTER_URL", nil},
		{"bad values", map[string]string{"AUTH_DEV_SIGNIN": "yes please", "SMTP_TLS": "ssl", "SMTP_PORT": "0", "SESSION_TTL": "a week",
			"MAIL_FROM": "not an address"}, "AUTH_DEV_SIGNIN", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, k := range []string{"HTTP_ADDR", "DATABASE_URL", "PUBLIC_URL", "PORTAL_URL", "DOCS_URL", "MEDIA_URL", "SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
				"SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_TLS", "MAIL_FROM", "SESSION_TTL", "COOKIE_SECURE", "AUTH_DEV_SIGNIN", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "DOCUMENTS_MAX_UPLOAD_MB", "S3_OBJECT_LOCK_DAYS", "S3_OBJECT_LOCK_MODE", "S3_PROXY_DOWNLOADS", "S3_ADDRESSING",
				"STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_AUTOMATIC_TAX", "STRIPE_API_BASE", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_FALLBACK_MODEL", "HEIDI_OPENAI_API_KEY", "HEIDI_OPENAI_MODEL", "HEIDI_MONTHLY_TOKENS", "TRUSTED_PROXY_CIDRS", "KSEF_API_URL", "UID_REGISTER_URL", "AI_FAKE_PROVIDER", "HELVETLY_E2E_FAKE_AI", "FEEDBACK_EMAIL", "GOOGLE_ANALYTICS_ID", "PUBLIC_API_URL", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CUSTOM_DOMAIN_TARGET", "CLOUDFLARE_API_URL", "HELVETLY_E2E_FAKE_DOMAINS"} {
				t.Setenv(k, tc.env[k])
			}
			for _, k := range []string{"S3_ACCESS_KEY", "S3_SECRET_KEY"} { // required: every case has them unless it says "-"
				v := tc.env[k]
				switch v {
				case "":
					v = "key"
				case "-":
					v = ""
				}
				t.Setenv(k, v)
			}
			c, err := Load()
			if tc.err != "" {
				if err == nil || !strings.Contains(err.Error(), tc.err) {
					t.Fatalf("err = %v, want %q", err, tc.err)
				}
				return
			}
			if err != nil || !tc.check(c) {
				t.Fatalf("Load() = %+v, %v", c, err)
			}
		})
	}
}
