/**
 * 模型回答里常用的那点 Markdown 画成网页元素：段落、换行、**粗体**、`代码`、```代码块```、列表、标题。
 * 只用 createElement + textContent 拼，从不写 innerHTML：模型（或者被诱导的模型）写什么标签都只是文字。
 */

function inline(text: string, into: HTMLElement) {
  // `代码` 和 **粗体**，别的原样
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) into.append(text.slice(at, m.index));
    const node = document.createElement(m[1] !== undefined ? 'code' : 'strong');
    node.textContent = m[1] ?? m[2];
    into.append(node);
    at = m.index + m[0].length;
  }
  if (at < text.length) into.append(text.slice(at));
}

export function renderMarkdown(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const flush = () => {
    if (para.length) {
      const p = document.createElement('p');
      para.forEach((line, i) => {
        if (i) p.append(document.createElement('br'));
        inline(line, p);
      });
      out.append(p);
      para = [];
    }
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const pre = document.createElement('pre');
      pre.textContent = code.join('\n');
      out.append(pre);
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)、])\s+(.*)$/.exec(line);
    if (bullet) {
      if (para.length) flush();
      const ordered = /^\s*\d/.test(line);
      if (!list || (list.tagName === 'OL') !== ordered) {
        list = document.createElement(ordered ? 'ol' : 'ul');
        out.append(list);
      }
      const li = document.createElement('li');
      inline(bullet[1], li);
      list.append(li);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const h = document.createElement('p');
      const strong = document.createElement('strong');
      inline(heading[1], strong);
      h.append(strong);
      out.append(h);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    list = null;
    para.push(line);
  }
  flush();
  return out;
}
