-- Offer reset (owner's decision of 2026-11-24, before any real customer): one offer, helvetly-v1, replaces
-- helvetly-v1 … helvetly-v1.5. It adds the Free plan (no subscription, never expires: a workspace without a paid plan
-- after its trial is on Free, its additions above Free's limits refused, nothing deleted), tiered prices (a plan's
-- price covers its included people, each further person costs extra; per-person limits grow with max(paid people,
-- included people)), expenses and scheduling on Basic, a 14-day Pro trial and remove_branding (no "Sent with
-- Helvetly" on client email and PDFs: Pro and Business).
-- Every workspace, checkout and override on an earlier offer moves to helvetly-v1 with its plan and subscription as
-- they are (a subscription keeps its Stripe price until `helvetly billing reprice` moves it); an override on another
-- offer than the workspace's own is dropped, as it applied to nothing. Safe to run again: each step converges.

-- +goose Up
ALTER TABLE limit_plans DROP CONSTRAINT IF EXISTS limit_plans_plan_id_check;
ALTER TABLE limit_plans ADD CONSTRAINT limit_plans_plan_id_check CHECK (plan_id IN ('free', 'basic', 'pro', 'business'));

INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'remove_branding', 'access', 'boolean', 'workspace', NULL, '{}'::text[], true, max(position) + 1,
    'No "Sent with Helvetly" on client email and PDFs'
FROM limits
ON CONFLICT (key) DO NOTHING;

ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;

DELETE FROM limit_workspaces w USING workspace_billing b
WHERE b.workspace_id = w.workspace_id AND b.offer_id IS NOT NULL AND w.offer_id <> b.offer_id;
DELETE FROM limit_workspaces w USING limit_workspaces o
WHERE o.workspace_id = w.workspace_id AND o.limit_key = w.limit_key AND o.offer_id > w.offer_id;
UPDATE limit_workspaces SET offer_id = 'helvetly-v1' WHERE offer_id <> 'helvetly-v1';
UPDATE workspace_billing SET offer_id = 'helvetly-v1' WHERE offer_id IS NOT NULL AND offer_id <> 'helvetly-v1';
UPDATE billing_checkouts SET offer_id = 'helvetly-v1' WHERE offer_id <> 'helvetly-v1';

DELETE FROM limit_plans;
DELETE FROM offer_versions WHERE id <> 'helvetly-v1';
-- Its checksum is Offer.Checksum of this document (billing's TestOfferResetMigration checks it).
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document) VALUES
('helvetly-v1', 1, 'af624cd9681b4edb5adf73fff0923e02ce6b419d9efc355775837ca5f6098bdf', now(), '{
  "schema_version": 1,
  "offer_id": "helvetly-v1",
  "billing": {
    "currencies": [
      "CHF",
      "EUR",
      "USD"
    ],
    "plans": {
      "basic": {
        "month_minor": 1900,
        "year_minor": 18300,
        "included_people": 1,
        "extra_person_month_minor": 1000,
        "extra_person_year_minor": 9600
      },
      "pro": {
        "month_minor": 4900,
        "year_minor": 47100,
        "included_people": 2,
        "extra_person_month_minor": 1500,
        "extra_person_year_minor": 14400
      },
      "business": {
        "month_minor": 14900,
        "year_minor": 143100,
        "included_people": 5,
        "extra_person_month_minor": 2000,
        "extra_person_year_minor": 19200
      }
    }
  },
  "records": [
    {
      "key": "identity_security",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "workspace_roles",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "clients_contacts",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "products_catalog",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "quotes",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "invoice_documents",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "invoice_corrections",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "swiss_qr",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "revolut_payment_link",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "invoice_payments",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "invoice_delivery",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "automations",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "invoice_reminders",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      },
      "requires_features": [
        "automations"
      ]
    },
    {
      "key": "invoice_instalments",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      },
      "requires_features": [
        "automations"
      ]
    },
    {
      "key": "einvoice_xml",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "expenses",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "engagement_management",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "engagement_automation",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      },
      "requires_features": [
        "automations"
      ]
    },
    {
      "key": "document_library",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "document_templates",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "simple_signatures",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "recipient_document_access",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "ai_import",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "dashboard_reports",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "vat_returns",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "ledger_exports",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "period_closing_audit",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "data_export",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "api_access",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "notifications",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "heidi",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    },
    {
      "key": "client_portal",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "qualified_signatures",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "disabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "einvoice_network_delivery",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "disabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "bank_sync",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "disabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "payroll_inventory",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "disabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "receivables_card_checkout",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "disabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "seats",
      "type": "resource_state",
      "unit": "seat",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 1
        },
        "business": {
          "state": "limited",
          "value": 1
        },
        "free": {
          "state": "limited",
          "value": 1
        },
        "pro": {
          "state": "limited",
          "value": 1
        }
      },
      "per_additional_paid_seat": {
        "basic": 1,
        "business": 1,
        "free": 1,
        "pro": 1
      }
    },
    {
      "key": "clients",
      "type": "resource_state",
      "unit": "client",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 30
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 5
        },
        "pro": {
          "state": "limited",
          "value": 300
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "products",
      "type": "resource_state",
      "unit": "catalog_item",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 25
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 10
        },
        "pro": {
          "state": "limited",
          "value": 250
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "automation_actions_per_month",
      "type": "period_counter",
      "unit": "automation_action",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 0
        },
        "business": {
          "state": "limited",
          "value": 6000
        },
        "free": {
          "state": "limited",
          "value": 0
        },
        "pro": {
          "state": "limited",
          "value": 1500
        }
      },
      "requires_features": [
        "automations"
      ],
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 6000,
        "free": 0,
        "pro": 1500
      }
    },
    {
      "key": "invoices_per_month",
      "type": "period_counter",
      "unit": "issued_document",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 15
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 3
        },
        "pro": {
          "state": "limited",
          "value": 100
        }
      },
      "per_additional_paid_seat": {
        "basic": 15,
        "business": 0,
        "free": 3,
        "pro": 100
      }
    },
    {
      "key": "quotes_per_month",
      "type": "period_counter",
      "unit": "issued_quote",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 5
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 3
        },
        "pro": {
          "state": "limited",
          "value": 100
        }
      },
      "per_additional_paid_seat": {
        "basic": 5,
        "business": 0,
        "free": 3,
        "pro": 100
      }
    },
    {
      "key": "expenses_per_month",
      "type": "period_counter",
      "unit": "expense",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 10
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 1
        },
        "pro": {
          "state": "limited",
          "value": 300
        }
      },
      "requires_features": [
        "expenses"
      ],
      "per_additional_paid_seat": {
        "basic": 10,
        "business": 0,
        "free": 1,
        "pro": 300
      }
    },
    {
      "key": "invoice_drafts",
      "type": "resource_state",
      "unit": "draft",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 100
        },
        "business": {
          "state": "limited",
          "value": 5000
        },
        "free": {
          "state": "limited",
          "value": 50
        },
        "pro": {
          "state": "limited",
          "value": 1000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "quotes_retained",
      "type": "resource_state",
      "unit": "quote",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 500
        },
        "business": {
          "state": "limited",
          "value": 25000
        },
        "free": {
          "state": "limited",
          "value": 100
        },
        "pro": {
          "state": "limited",
          "value": 5000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "engagements",
      "type": "resource_state",
      "unit": "engagement",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 3
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 1
        },
        "pro": {
          "state": "limited",
          "value": 20
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "signatures_per_month",
      "type": "period_counter",
      "unit": "signature_envelope",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 0
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 0
        },
        "pro": {
          "state": "limited",
          "value": 50
        }
      },
      "requires_features": [
        "simple_signatures"
      ],
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 50
      }
    },
    {
      "key": "storage_bytes",
      "type": "resource_state",
      "unit": "byte",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 500000000
        },
        "business": {
          "state": "limited",
          "value": 20000000000
        },
        "free": {
          "state": "limited",
          "value": 100000000
        },
        "pro": {
          "state": "limited",
          "value": 5000000000
        }
      },
      "per_additional_paid_seat": {
        "basic": 500000000,
        "business": 20000000000,
        "free": 100000000,
        "pro": 5000000000
      }
    },
    {
      "key": "emails_per_month",
      "type": "period_counter",
      "unit": "recipient_message",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 100
        },
        "business": {
          "state": "limited",
          "value": 2000
        },
        "free": {
          "state": "limited",
          "value": 20
        },
        "pro": {
          "state": "limited",
          "value": 500
        }
      },
      "per_additional_paid_seat": {
        "basic": 100,
        "business": 2000,
        "free": 20,
        "pro": 500
      }
    },
    {
      "key": "ai_tokens_per_month",
      "type": "period_counter",
      "unit": "token",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 0
        },
        "business": {
          "state": "limited",
          "value": 20000000
        },
        "free": {
          "state": "limited",
          "value": 0
        },
        "pro": {
          "state": "limited",
          "value": 5000000
        }
      },
      "requires_features": [
        "ai_import"
      ],
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 20000000,
        "free": 0,
        "pro": 5000000
      }
    },
    {
      "key": "ai_cost_usd_micros",
      "type": "cost_budget",
      "unit": "USD_micro",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 0
        },
        "business": {
          "state": "limited",
          "value": 12000000
        },
        "free": {
          "state": "limited",
          "value": 0
        },
        "pro": {
          "state": "limited",
          "value": 3000000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 12000000,
        "free": 0,
        "pro": 3000000
      }
    },
    {
      "key": "ai_automation_tokens_per_month",
      "type": "period_counter",
      "unit": "token",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 0
        },
        "business": {
          "state": "limited",
          "value": 20000000
        },
        "free": {
          "state": "limited",
          "value": 0
        },
        "pro": {
          "state": "limited",
          "value": 5000000
        }
      },
      "requires_features": [
        "ai_import"
      ],
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 20000000,
        "free": 0,
        "pro": 5000000
      }
    },
    {
      "key": "ai_automation_cost_usd_micros",
      "type": "cost_budget",
      "unit": "USD_micro",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 0
        },
        "business": {
          "state": "limited",
          "value": 12000000
        },
        "free": {
          "state": "limited",
          "value": 0
        },
        "pro": {
          "state": "limited",
          "value": 3000000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 12000000,
        "free": 0,
        "pro": 3000000
      }
    },
    {
      "key": "max_upload_bytes",
      "type": "technical_guard",
      "unit": "byte",
      "scope": "file",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 26214400
        },
        "business": {
          "state": "limited",
          "value": 26214400
        },
        "free": {
          "state": "limited",
          "value": 26214400
        },
        "pro": {
          "state": "limited",
          "value": 26214400
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "max_ai_attachment_bytes",
      "type": "technical_guard",
      "unit": "byte",
      "scope": "file",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 8388608
        },
        "business": {
          "state": "limited",
          "value": 8388608
        },
        "free": {
          "state": "limited",
          "value": 8388608
        },
        "pro": {
          "state": "limited",
          "value": 8388608
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "max_signature_signers",
      "type": "technical_guard",
      "unit": "signer",
      "scope": "signature_envelope",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 10
        },
        "business": {
          "state": "limited",
          "value": 10
        },
        "free": {
          "state": "limited",
          "value": 10
        },
        "pro": {
          "state": "limited",
          "value": 10
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "ai_concurrency",
      "type": "technical_guard",
      "unit": "call",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 1
        },
        "business": {
          "state": "limited",
          "value": 1
        },
        "free": {
          "state": "limited",
          "value": 1
        },
        "pro": {
          "state": "limited",
          "value": 1
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "ai_import_call_max_usd_micros",
      "type": "technical_guard",
      "unit": "USD_micro",
      "scope": "provider_call",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 50000
        },
        "business": {
          "state": "limited",
          "value": 50000
        },
        "free": {
          "state": "limited",
          "value": 50000
        },
        "pro": {
          "state": "limited",
          "value": 50000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "ai_heidi_operation_max_usd_micros",
      "type": "technical_guard",
      "unit": "USD_micro",
      "scope": "operation",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 250000
        },
        "business": {
          "state": "limited",
          "value": 250000
        },
        "free": {
          "state": "limited",
          "value": 250000
        },
        "pro": {
          "state": "limited",
          "value": 250000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "ai_input_tokens_max",
      "type": "technical_guard",
      "unit": "input_token",
      "scope": "provider_call",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 100000
        },
        "business": {
          "state": "limited",
          "value": 100000
        },
        "free": {
          "state": "limited",
          "value": 100000
        },
        "pro": {
          "state": "limited",
          "value": 100000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "max_self_service_seats",
      "type": "technical_guard",
      "unit": "seat",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 5
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 1
        },
        "pro": {
          "state": "limited",
          "value": 25
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "max_email_attachment_bytes",
      "type": "technical_guard",
      "unit": "byte",
      "scope": "message_recipient",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 10485760
        },
        "business": {
          "state": "limited",
          "value": 10485760
        },
        "free": {
          "state": "limited",
          "value": 10485760
        },
        "pro": {
          "state": "limited",
          "value": 10485760
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "ai_import_file_max_usd_micros",
      "type": "technical_guard",
      "unit": "USD_micro",
      "scope": "import_file",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 250000
        },
        "business": {
          "state": "limited",
          "value": 250000
        },
        "free": {
          "state": "limited",
          "value": 250000
        },
        "pro": {
          "state": "limited",
          "value": 250000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "ai_import_batch_max_usd_micros",
      "type": "technical_guard",
      "unit": "USD_micro",
      "scope": "import_batch",
      "period": null,
      "values": {
        "basic": {
          "state": "limited",
          "value": 1000000
        },
        "business": {
          "state": "limited",
          "value": 1000000
        },
        "free": {
          "state": "limited",
          "value": 1000000
        },
        "pro": {
          "state": "limited",
          "value": 1000000
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "api_write_requests_per_minute",
      "type": "technical_guard",
      "unit": "request",
      "scope": "workspace",
      "period": "rolling_minute",
      "values": {
        "basic": {
          "state": "limited",
          "value": 60
        },
        "business": {
          "state": "limited",
          "value": 60
        },
        "free": {
          "state": "limited",
          "value": 60
        },
        "pro": {
          "state": "limited",
          "value": 60
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "api_read_requests_per_minute",
      "type": "technical_guard",
      "unit": "request",
      "scope": "workspace",
      "period": "rolling_minute",
      "values": {
        "basic": {
          "state": "limited",
          "value": 300
        },
        "business": {
          "state": "limited",
          "value": 300
        },
        "free": {
          "state": "limited",
          "value": 300
        },
        "pro": {
          "state": "limited",
          "value": 300
        }
      },
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "employees",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      }
    },
    {
      "key": "custom_portal_domain",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      },
      "requires_features": [
        "client_portal"
      ]
    },
    {
      "key": "document_approvals",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "disabled"
        }
      },
      "requires_features": []
    },
    {
      "key": "scheduling",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "enabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "enabled"
        },
        "pro": {
          "state": "enabled"
        }
      },
      "requires_features": []
    },
    {
      "key": "scheduled_events_per_month",
      "type": "period_counter",
      "unit": "scheduled_event",
      "scope": "workspace",
      "period": "calendar_month_utc",
      "values": {
        "basic": {
          "state": "limited",
          "value": 10
        },
        "business": {
          "state": "unlimited"
        },
        "free": {
          "state": "limited",
          "value": 3
        },
        "pro": {
          "state": "limited",
          "value": 100
        }
      },
      "requires_features": [
        "scheduling"
      ],
      "per_additional_paid_seat": {
        "basic": 0,
        "business": 0,
        "free": 0,
        "pro": 0
      }
    },
    {
      "key": "remove_branding",
      "type": "access",
      "unit": "boolean",
      "scope": "workspace",
      "period": null,
      "values": {
        "basic": {
          "state": "disabled"
        },
        "business": {
          "state": "enabled"
        },
        "free": {
          "state": "disabled"
        },
        "pro": {
          "state": "enabled"
        }
      }
    }
  ],
  "usage_policy": {
    "pooled_by_paid_seat_keys": [
      "invoices_per_month",
      "quotes_per_month",
      "expenses_per_month",
      "signatures_per_month",
      "storage_bytes",
      "emails_per_month",
      "ai_cost_usd_micros",
      "automation_actions_per_month",
      "ai_tokens_per_month",
      "ai_automation_tokens_per_month",
      "ai_automation_cost_usd_micros"
    ]
  },
  "trial": {
    "days": 14,
    "seats": 2,
    "overrides": {},
    "access_plan": "pro"
  },
  "public_pricing": {
    "comparison_rows": [
      {
        "key": "invoicing",
        "label_en": "Invoices and quotes",
        "limit_keys": [
          "invoices_per_month",
          "quotes_per_month"
        ],
        "feature_keys": [
          "invoice_documents",
          "quotes"
        ]
      },
      {
        "key": "swiss_qr",
        "label_en": "Swiss QR bills",
        "limit_keys": [],
        "feature_keys": [
          "swiss_qr"
        ]
      },
      {
        "key": "revolut",
        "note_en": "revolut.me link and QR; the payer enters the displayed amount and reference. No bank sync or automatic payment confirmation.",
        "label_en": "Revolut payment link",
        "limit_keys": [],
        "feature_keys": [
          "revolut_payment_link"
        ]
      },
      {
        "key": "engagements",
        "note_en": "Manual engagement management in every plan; scheduled workflows require Pro or Business.",
        "label_en": "Engagements and retainers",
        "limit_keys": [
          "engagements"
        ],
        "feature_keys": [
          "engagement_management"
        ]
      },
      {
        "key": "scheduling",
        "label_en": "Scheduling, booking links and calendar sync",
        "limit_keys": [
          "scheduled_events_per_month"
        ],
        "feature_keys": [
          "scheduling"
        ]
      },
      {
        "key": "automations",
        "label_en": "Automations and payment reminders",
        "limit_keys": [
          "automation_actions_per_month"
        ],
        "feature_keys": [
          "automations"
        ]
      },
      {
        "key": "heidi",
        "label_en": "Heidi AI assistant",
        "limit_keys": [
          "ai_tokens_per_month"
        ],
        "feature_keys": [
          "heidi"
        ]
      },
      {
        "key": "client_portal",
        "label_en": "Client portal",
        "limit_keys": [],
        "feature_keys": [
          "client_portal"
        ]
      },
      {
        "key": "expenses",
        "label_en": "Expenses and receipts",
        "limit_keys": [
          "expenses_per_month"
        ],
        "feature_keys": [
          "expenses"
        ]
      },
      {
        "key": "ai_import",
        "label_en": "AI import of receipts, invoices and documents",
        "limit_keys": [
          "ai_automation_tokens_per_month"
        ],
        "feature_keys": [
          "ai_import"
        ]
      },
      {
        "key": "documents_signatures",
        "label_en": "Document templates and simple signatures",
        "limit_keys": [
          "signatures_per_month"
        ],
        "feature_keys": [
          "document_templates",
          "simple_signatures"
        ]
      },
      {
        "key": "corrections_vat",
        "label_en": "Invoice corrections and VAT returns",
        "limit_keys": [],
        "feature_keys": [
          "invoice_corrections",
          "vat_returns"
        ]
      },
      {
        "key": "einvoice_xml",
        "note_en": "Supported file formats only; no network delivery.",
        "label_en": "E-invoice XML export",
        "limit_keys": [],
        "feature_keys": [
          "einvoice_xml"
        ]
      },
      {
        "key": "ledger_exports",
        "note_en": "Accounting reports and supported exports, including client and product CSV exports. Individual invoice PDFs remain available in Basic; e-invoice XML requires Business.",
        "label_en": "Ledger and data exports",
        "limit_keys": [],
        "feature_keys": [
          "ledger_exports",
          "data_export"
        ]
      },
      {
        "key": "employees",
        "note_en": "Staff records, employee documents and a payroll register you fill in or import. No payroll calculation, payslips or filings.",
        "label_en": "Employees and payroll register",
        "limit_keys": [],
        "feature_keys": [
          "employees"
        ]
      },
      {
        "key": "remove_branding",
        "label_en": "No “Sent with Helvetly” on email and PDFs",
        "limit_keys": [],
        "feature_keys": [
          "remove_branding"
        ]
      }
    ],
    "internal_only_keys": [
      "identity_security",
      "workspace_roles",
      "period_closing_audit",
      "api_access",
      "notifications",
      "ai_cost_usd_micros",
      "ai_automation_cost_usd_micros"
    ],
    "usage_details_keys": [
      "clients",
      "products",
      "invoices_per_month",
      "quotes_per_month",
      "expenses_per_month",
      "signatures_per_month",
      "storage_bytes",
      "emails_per_month",
      "ai_tokens_per_month",
      "automation_actions_per_month",
      "engagements",
      "scheduled_events_per_month"
    ]
  }
}')
ON CONFLICT (id) DO UPDATE SET schema_version = EXCLUDED.schema_version, checksum = EXCLUDED.checksum,
    published_at = EXCLUDED.published_at, document = EXCLUDED.document;

ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT id, p.plan, r->>'key', p.v->>'state', (p.v->>'value')::bigint,
    coalesce((r->'per_additional_paid_seat'->>p.plan)::bigint, 0)
FROM offer_versions, jsonb_array_elements(document->'records') r, jsonb_each(r->'values') AS p (plan, v)
WHERE id = 'helvetly-v1';

INSERT INTO offer_audit (actor, action, target, before, after, reason)
SELECT 'migration 00065', 'offer.reset', id, NULL, jsonb_build_object('offer_id', id, 'checksum', checksum),
    'Offers reset to helvetly-v1 (Free plan, tiered prices), approved by the owner on 2026-11-24'
FROM offer_versions WHERE id = 'helvetly-v1';

-- +goose Down
-- The earlier offers are not brought back (none had a customer); Free's values and remove_branding go, so the
-- earlier migrations' Down steps find what they expect.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
DELETE FROM limit_plans WHERE plan_id = 'free' OR limit_key = 'remove_branding';
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
DELETE FROM limit_workspaces WHERE limit_key = 'remove_branding';
DELETE FROM limits WHERE key = 'remove_branding';
ALTER TABLE limit_plans DROP CONSTRAINT limit_plans_plan_id_check;
ALTER TABLE limit_plans ADD CONSTRAINT limit_plans_plan_id_check CHECK (plan_id IN ('basic', 'pro', 'business'));
