package auth

import (
	"context"
	"net/http"

	"helvetly.com/api/internal/store"
)

// RequireAIConsent refuses an AI model call the person has not approved in this workspace. Approval is each member's
// own: another member's row never counts. Call it before any provider request, counting included.
func RequireAIConsent(ctx context.Context, q store.Q, workspaceID, userID string) error {
	c, err := q.AIConsent(ctx, workspaceID, userID)
	if err == nil && !c.Granted {
		err = Error(http.StatusForbidden, "ai_consent_required", "You have not approved AI use in this workspace yet. Approve it when Helvetly asks; nothing was sent to the AI model.", nil)
	}
	return err
}
