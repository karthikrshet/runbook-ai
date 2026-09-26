import type { RunView } from '../../shared/view';
import { useElapsed } from '../lib/api';
import { integrationIndicators, type StreamState } from '../lib/console';
import { duration, shortId } from '../lib/format';
import { useTheme } from '../lib/prefs';
import { ChevronIcon, ExternalIcon, MoonIcon, SunIcon } from './Icons';

interface StatusStripProps {
  view: RunView;
  stream: StreamState;
  sourcesOpen: boolean;
  onToggleSources: () => void;
}

/**
 * Runtime status under the masthead. Each indicator states only what TrueForge's
 * record for this session shows; hover or open Data sources for the basis.
 */
export function StatusStrip({ view, stream, sourcesOpen, onToggleSources }: StatusStripProps) {
  const indicators = integrationIndicators(view, stream);
  const elapsed = useElapsed(view);
  const [theme, setTheme] = useTheme();

  return (
    <div className="status-strip">
      <ul className="status-strip__list" aria-label="Integrations">
        {indicators.map((indicator) => (
          <li
            key={indicator.key}
            className={`indicator indicator--${indicator.tone}`}
            title={indicator.basis}
          >
            <span className="indicator__dot" aria-hidden="true" />
            <span className="indicator__name">{indicator.name}</span>
            <span className="indicator__state">{indicator.state}</span>
          </li>
        ))}
      </ul>

      <div className="status-strip__meta">
        {elapsed !== null && (
          <span className="status-strip__elapsed">
            Elapsed <time>{duration(elapsed)}</time>
          </span>
        )}
        <span className="runtime-mark">
          Powered by <strong>TrueForge</strong>
          {view.session.uiUrl ? (
            <a
              href={view.session.uiUrl}
              target="_blank"
              rel="noreferrer"
              className="runtime-mark__link"
            >
              session <code>{shortId(view.session.id, 10)}</code>
              <ExternalIcon />
            </a>
          ) : (
            <span className="runtime-mark__none">· no session (demo)</span>
          )}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setTheme(theme === 'dark' ? 'light' : 'dark');
          }}
          aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className="text-button"
          aria-expanded={sourcesOpen}
          aria-controls="data-sources"
          onClick={onToggleSources}
        >
          Data sources
          <ChevronIcon className={`icon chevron ${sourcesOpen ? 'chevron--open' : ''}`} />
        </button>
      </div>
    </div>
  );
}
