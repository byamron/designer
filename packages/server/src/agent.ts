import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const AGENT_PATH = '/__designer/agent.js';
let source: string | undefined;

/** The page-agent script served to previewed pages (assets/agent.js). */
export function agentSource(): string {
  return (source ??= readFileSync(fileURLToPath(new URL('../assets/agent.js', import.meta.url)), 'utf8'));
}

/**
 * Add the agent to an HTML document. `origins` are the app origins the agent will accept messages from;
 * it is inert for anyone else. Inserted before the last </body> so it runs after the page's own markup.
 */
export function injectAgent(html: string, origins: string[]): string {
  const tag = `<script src="${AGENT_PATH}" data-designer-agent data-origins="${origins.join(',')}"></script>`;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag;
}
