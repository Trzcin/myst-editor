import markdownIt from "markdown-it";
import { escapeHtml } from "markdown-it/lib/common/utils";

const SRC_LINE_ID = "data-line-id";
const randomLineId = () => Math.random().toString().replace(".", "");

/** @param {markdownIt} md  */
export default function markdownSourceMap(md) {
  md.use(overrideDefaultDirectives);
  md.use(wrapTextInSpan);
  md.use(wrapFencedLinesInSpan);

  const excludeRules = ["softbreak"];
  const overrideRules = [
    ...Object.keys(md.renderer.rules).filter((r) => !excludeRules.includes(r)),
    "paragraph_open",
    "heading_open",
    "admonition_open",
    "link_open",
  ];

  for (const rule of overrideRules) {
    const temp = md.renderer.rules[rule];
    md.renderer.rules[rule] = addLineNumberToTokens(temp);
  }
}

function addLineNumberToTokens(defaultRule) {
  /**
   * @param {import("markdown-it/index.js").Token[]} tokens
   * @param {number} idx
   * @param {import("markdown-it/index.js").Renderer} self
   */
  return (tokens, idx, options, env, self) => {
    const inlineContainers = ["paragraph_open", "heading_open"];
    if (inlineContainers.includes(tokens[idx].type)) {
      const inlineToken = tokens[idx + 1];
      let lineInParagraph = 0;
      let lineUsed = false;
      for (const childToken of inlineToken.children) {
        if (childToken.type === "softbreak") {
          lineInParagraph++;
          lineUsed = false;
          continue;
        }

        if (!lineUsed) {
          childToken.map = [tokens[idx].map[0] + lineInParagraph, tokens[idx].map[0] + lineInParagraph + 1];
          lineUsed = true;
        }
      }
    } else if (tokens[idx].map) {
      const line = tokens[idx].map[0] + env.startLine - (env.chunkId !== 0);
      const id = randomLineId();
      env.lineMap.current.set(line, id);
      tokens[idx].attrSet(SRC_LINE_ID, id);
    }

    if (defaultRule) {
      // if a rule existed for this token, execute it
      return defaultRule(tokens, idx, options, env, self);
    } else {
      // pass tokens to the default renderer
      return self.renderToken(tokens, idx, options);
    }
  };
}

/** The fallback renderer rule for unhandled and error directives does not output the token attributes into the html **/
function overrideDefaultDirectives(/** @type {markdownIt} */ md) {
  function newRule(defaultRule) {
    return (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      let html = defaultRule(tokens, idx, options, env, self);
      const asideCloseIdx = html.indexOf(">");
      html = html.slice(0, asideCloseIdx) + self.renderAttrs(token) + html.slice(asideCloseIdx);
      return html;
    };
  }

  md.renderer.rules.directive = newRule(md.renderer.rules.directive);
  md.renderer.rules["directive_error"] = newRule(md.renderer.rules["directive_error"]);
}

/** We need some way to add line info to html text, so the idea is to wrap every text token in a span **/
function wrapTextInSpan(/** @type {markdownIt} */ md) {
  const defaultTextRule = md.renderer.rules.text;
  md.renderer.rules.text = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const defaultOutput = defaultTextRule(tokens, idx, options, env, self);
    let html = `<span${self.renderAttrs(token)}>${defaultOutput}</span>`;
    return html;
  };
}

/** Currently the contents of a fenced code block are treated as a singular string so we need to wrap each line with a `span` to attach line metadata.
    If we ever decide to add syntax highlighting in fenced code blocks, this will need to be changed. **/
function wrapFencedLinesInSpan(/** @type {markdownIt} */ md) {
  const defaultFenceRule = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const defaultOutput = defaultFenceRule(tokens, idx, options, env, self);
    const token = tokens[idx];
    // Some markdown-it extensions use the `fence` rule for other things than code blocks (eg. mermaid graphs) so we don't want to modify those
    if (!defaultOutput.startsWith("<pre")) {
      const closeIdx = defaultOutput.indexOf(">");
      const start = defaultOutput.slice(0, closeIdx);
      const end = defaultOutput.slice(closeIdx);
      // Mermaid graphs do not get the attributes from the token directly, so we need to add them manually.
      return start + ` ${self.renderAttrs(token)}` + end;
    }

    const sanitizedContent = escapeHtml(token.content);
    const startLine = token.map[0] + env.startLine - (env.chunkId !== 0);
    let htmlContent = sanitizedContent
      .split("\n")
      .filter((_, i, lines) => i !== lines.length - 1)
      .map((l, i) => {
        const id = randomLineId();
        env.lineMap.current.set(startLine + i + 1, id);
        return `<span ${SRC_LINE_ID}="${id}">${l}</span>`;
      })
      .join("\n");

    return `<pre><code${self.renderAttrs(token)}>${htmlContent}</code></pre>\n`;
  };
}
