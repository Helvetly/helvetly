package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Admission checks a resource addition using the same transaction as the canonical write.
// It must retain its concurrency lock until that transaction commits or rolls back.
type Admission func(context.Context, Q, string, string, int64) error

// ErrAdmissionDenied lets public workflows return a neutral error without exposing a workspace plan.
var ErrAdmissionDenied = errors.New("resource admission denied")

// SetAdmission is startup wiring: call once before requests or jobs start. Existing Q values keep
// their callback, so it is deliberately not a runtime configuration switch.
func (s *Store) SetAdmission(admit Admission) { s.Q.admission = admit }

func (q Q) admissionTx(ctx context.Context, write func(Q) error) error {
	if q.admission == nil {
		return write(q)
	}
	return q.writeTx(ctx, write)
}

// writeTx runs write in q's transaction, or in a new one when q is not in one.
func (q Q) writeTx(ctx context.Context, write func(Q) error) error {
	if _, ok := q.db.(pgx.Tx); ok {
		return write(q)
	}
	beginner, ok := q.db.(interface {
		Begin(context.Context) (pgx.Tx, error)
	})
	if !ok {
		return fmt.Errorf("database cannot begin a transaction")
	}
	return pgx.BeginFunc(ctx, beginner, func(tx pgx.Tx) error { return write(q.on(tx)) })
}

// Admit permits preflight checks inside an existing write transaction (for example before S3 PUT).
// Rechecking the same addition does not reserve or charge it twice: usage comes only from written rows.
func (q Q) Admit(ctx context.Context, workspaceID, resource string, add int64) error {
	if q.admission == nil {
		return nil
	}
	if _, ok := q.db.(pgx.Tx); !ok {
		return fmt.Errorf("quota admission requires a write transaction")
	}
	return q.admission(ctx, q, workspaceID, resource, add)
}

func (q Q) admitted(ctx context.Context, workspaceID, resource string, add int64, write func(Q) error) error {
	return q.admissionTx(ctx, func(q Q) error {
		if err := q.Admit(ctx, workspaceID, resource, add); err != nil {
			return err
		}
		return write(q)
	})
}

// LockAdmission serializes additions with plan changes before taking a resource lock.
// Every admission follows this order, including transactions that add several resource types.
func (q Q) LockAdmission(ctx context.Context, workspaceID, resource string) error {
	if err := q.LockBilling(ctx, workspaceID); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,7))`, "resource-admission:"+workspaceID+":"+resource)
	return err
}
