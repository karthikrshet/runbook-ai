import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ToolCallView } from '../../shared/view';
import { postDecision } from '../lib/api';
import { describeAction } from '../lib/copy';
import { ExternalIcon } from './Icons';

type Step =
  | { kind: 'choose' }
  | { kind: 'confirm-approve' }
  | { kind: 'reject' }
  | { kind: 'sending'; decision: 'allow' | 'deny' }
  | { kind: 'sent'; decision: 'allow' | 'deny' }
  | { kind: 'failed'; message: string };

interface DecisionControlsProps {
  sessionId: string;
  call: ToolCallView;
  trueforgeUrl: string | null;
}

/**
 * Approve or reject a tool call that TrueForge is holding. The decision is sent to
 * TrueForge as a `user.tool_approval`, the same call its own UI makes; the server
 * first checks TrueForge's record that the call is still waiting.
 */
export function DecisionControls({ sessionId, call, trueforgeUrl }: DecisionControlsProps) {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [reason, setReason] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const action = describeAction(call);
  // Policy authorizes, not the button: a forbidden action can only be rejected.
  const blocked = call.decision === 'deny';

  // After each step the user causes, move focus to the control that step is about.
  useEffect(() => {
    if (!userMoved.current) return;
    containerRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [step.kind]);

  const go = (next: Step): void => {
    userMoved.current = true;
    setStep(next);
  };

  const send = (decision: 'allow' | 'deny'): void => {
    go({ kind: 'sending', decision });
    postDecision(sessionId, {
      toolCallId: call.id,
      decision,
      ...(decision === 'deny' && reason.trim() ? { reason: reason.trim() } : {}),
    })
      .then(() => {
        setStep({ kind: 'sent', decision });
      })
      .catch((error: unknown) => {
        setStep({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (step.kind === 'confirm-approve' || step.kind === 'reject')) {
      go({ kind: 'choose' });
    }
  };

  const busy = step.kind === 'sending' || step.kind === 'sent';

  return (
    <div className="decide" ref={containerRef} onKeyDown={onKeyDown}>
      <div className="decide__text">
        <p className="decide__label">Your decision</p>
        {(step.kind === 'choose' || step.kind === 'failed') &&
          (blocked ? (
            <p>
              <strong>Policy blocks this action.</strong> It is forbidden, so it can only be
              rejected; nothing outside the sandbox changes.
            </p>
          ) : (
            <p>
              Approving lets TrueForge {action} now. Rejecting stops it, and nothing outside the
              sandbox changes.
            </p>
          ))}
        {step.kind === 'confirm-approve' && (
          <p>
            <strong>Approve and {action}?</strong> TrueForge runs it as soon as you confirm, and the
            run resumes on its own.
          </p>
        )}
        {step.kind === 'reject' && (
          <label className="decide__reason">
            <span>Reason for the agent (optional)</span>
            <textarea
              data-autofocus
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              placeholder="For example: wait for the owning team to review"
            />
          </label>
        )}
        {busy && (
          <p role="status">
            {step.kind === 'sending'
              ? `Sending your ${step.decision === 'allow' ? 'approval' : 'rejection'} to TrueForge…`
              : `${step.decision === 'allow' ? 'Approval' : 'Rejection'} recorded by TrueForge. This view updates when the run resumes.`}
          </p>
        )}
        {step.kind === 'failed' && (
          <p role="alert" className="decide__error">
            TrueForge did not record a decision. {step.message}
          </p>
        )}
      </div>

      <div className="decide__buttons">
        {(step.kind === 'choose' || step.kind === 'failed') && (
          <>
            {!blocked && (
              <button
                type="button"
                className="button button--approve"
                data-autofocus
                onClick={() => {
                  go({ kind: 'confirm-approve' });
                }}
              >
                Approve…
              </button>
            )}
            <button
              type="button"
              className="button button--reject"
              {...(blocked ? { 'data-autofocus': true } : {})}
              onClick={() => {
                go({ kind: 'reject' });
              }}
            >
              Reject…
            </button>
          </>
        )}
        {step.kind === 'confirm-approve' && (
          <>
            <button
              type="button"
              className="button button--approve"
              data-autofocus
              onClick={() => {
                send('allow');
              }}
            >
              Confirm approval
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                go({ kind: 'choose' });
              }}
            >
              Cancel
            </button>
          </>
        )}
        {step.kind === 'reject' && (
          <>
            <button
              type="button"
              className="button button--reject"
              onClick={() => {
                send('deny');
              }}
            >
              Confirm rejection
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                go({ kind: 'choose' });
              }}
            >
              Cancel
            </button>
          </>
        )}
        {busy && (
          <button type="button" className="button" disabled>
            {step.kind === 'sending' ? 'Sending…' : 'Sent to TrueForge'}
          </button>
        )}
      </div>

      {trueforgeUrl && (
        <a className="tf-link decide__alt" href={trueforgeUrl} target="_blank" rel="noreferrer">
          Or decide in TrueForge
          <ExternalIcon />
        </a>
      )}
    </div>
  );
}
