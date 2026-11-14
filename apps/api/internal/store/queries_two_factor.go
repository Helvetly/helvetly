package store

import (
	"context"
	"errors"
	"time"
)

type TwoFactor struct {
	Secret         string
	PendingSecret  *string
	PendingExpires *time.Time
	Enabled        bool
	LastStep       int64
	RecoveryCodes  int
	LockedUntil    *time.Time
}

func (q Q) AccountTwoFactor(ctx context.Context, userID string) (TwoFactor, error) {
	var v TwoFactor
	err := q.db.QueryRow(ctx, `SELECT secret,pending_secret,pending_expires_at,enabled,last_step,
		(SELECT count(*) FROM account_recovery_codes WHERE user_id=$1),locked_until FROM account_two_factor WHERE user_id=$1`, userID).
		Scan(&v.Secret, &v.PendingSecret, &v.PendingExpires, &v.Enabled, &v.LastStep, &v.RecoveryCodes, &v.LockedUntil)
	if errors.Is(err, ErrNotFound) {
		return TwoFactor{LastStep: -1}, nil
	}
	return v, err
}

func (q Q) SetPendingTwoFactor(ctx context.Context, userID, sealed string, expires time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO account_two_factor(user_id,secret,pending_secret,pending_expires_at)
		VALUES($1,'',$2,$3) ON CONFLICT(user_id) DO UPDATE SET pending_secret=$2,pending_expires_at=$3`, userID, sealed, expires)
	return err
}

func (q Q) EnableTwoFactor(ctx context.Context, userID, secret string, step int64, codes []string) error {
	if _, err := q.db.Exec(ctx, `UPDATE account_two_factor SET secret=$2,enabled=true,last_step=$3,pending_secret=NULL,pending_expires_at=NULL WHERE user_id=$1`, userID, secret, step); err != nil {
		return err
	}
	if _, err := q.db.Exec(ctx, `DELETE FROM account_recovery_codes WHERE user_id=$1`, userID); err != nil {
		return err
	}
	for _, hash := range codes {
		if _, err := q.db.Exec(ctx, `INSERT INTO account_recovery_codes(user_id,code_hash)VALUES($1,$2)`, userID, hash); err != nil {
			return err
		}
	}
	return nil
}

func (q Q) DisableTwoFactor(ctx context.Context, userID string) error {
	for _, sql := range []string{`DELETE FROM account_login_challenges WHERE user_id=$1`, `DELETE FROM account_recovery_codes WHERE user_id=$1`, `DELETE FROM account_two_factor WHERE user_id=$1`} {
		if _, err := q.db.Exec(ctx, sql, userID); err != nil {
			return err
		}
	}
	return nil
}

func (q Q) UseTwoFactorStep(ctx context.Context, userID string, step int64) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE account_two_factor SET last_step=$2 WHERE user_id=$1 AND enabled AND last_step<$2`, userID, step)
	return tag.RowsAffected() == 1, err
}

// FailTwoFactor counts one more wrong code and returns the consecutive count.
func (q Q) FailTwoFactor(ctx context.Context, userID string) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `UPDATE account_two_factor SET failed_attempts=failed_attempts+1 WHERE user_id=$1 RETURNING failed_attempts`, userID).Scan(&n)
	return n, err
}

func (q Q) LockTwoFactor(ctx context.Context, userID string, until time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE account_two_factor SET locked_until=$2 WHERE user_id=$1`, userID, until)
	return err
}

func (q Q) ResetTwoFactorFailures(ctx context.Context, userID string) error {
	_, err := q.db.Exec(ctx, `UPDATE account_two_factor SET failed_attempts=0,locked_until=NULL WHERE user_id=$1 AND (failed_attempts>0 OR locked_until IS NOT NULL)`, userID)
	return err
}

func (q Q) UseRecoveryCode(ctx context.Context, userID, hash string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM account_recovery_codes WHERE user_id=$1 AND code_hash=$2`, userID, hash)
	return tag.RowsAffected() == 1, err
}

func (q Q) CreateFactorChallenge(ctx context.Context, tokenHash, userID, workspaceID, next string, now time.Time) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM account_login_challenges WHERE expires_at<$1`, now); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `INSERT INTO account_login_challenges(token_hash,user_id,workspace_id,next_path,expires_at)VALUES($1,$2,$3,$4,$5)`, tokenHash, userID, workspaceID, next, now.Add(5*time.Minute))
	return err
}

type FactorChallenge struct{ UserID, WorkspaceID, Next string }

func (q Q) FactorChallengeUser(ctx context.Context, hash string, now time.Time) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT user_id FROM account_login_challenges WHERE token_hash=$1 AND expires_at>$2 AND attempts<5`, hash, now).Scan(&id)
	return id, err
}

func (q Q) AttemptFactorChallenge(ctx context.Context, hash string, now time.Time) (FactorChallenge, error) {
	var v FactorChallenge
	err := q.db.QueryRow(ctx, `UPDATE account_login_challenges SET attempts=attempts+1 WHERE token_hash=$1 AND expires_at>$2 AND attempts<5 RETURNING user_id,workspace_id,next_path`, hash, now).Scan(&v.UserID, &v.WorkspaceID, &v.Next)
	return v, err
}

func (q Q) DeleteFactorChallenge(ctx context.Context, hash string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM account_login_challenges WHERE token_hash=$1`, hash)
	return err
}
