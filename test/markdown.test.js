import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown.js';

describe('renderMarkdown', () => {
  it('converts headings, bold, lists, code and tables', () => {
    expect(renderMarkdown('# 見出しです')).toContain('<h1');
    expect(renderMarkdown('## 小見出し')).toContain('<h2');
    expect(renderMarkdown('これは **太字** です')).toContain('<strong>太字</strong>');
    const list = renderMarkdown('- りんご\n- みかん');
    expect(list).toContain('<ul>');
    expect(list).toContain('<li>りんご</li>');
    expect(renderMarkdown('`code` を含む文')).toContain('<code>code</code>');
    const block = renderMarkdown('```\nconst x = 1;\n```');
    expect(block).toContain('<pre>');
    expect(block).toContain('<code>');
    const table = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(table).toContain('<table>');
    expect(table).toContain('<td>1</td>');
  });

  it('renders blockquotes and keeps single line breaks (breaks: true)', () => {
    expect(renderMarkdown('> 引用です')).toContain('<blockquote>');
    expect(renderMarkdown('1行目\n2行目')).toContain('<br>');
  });

  it('opens links in a new tab with rel="noopener"', () => {
    const html = renderMarkdown('[例](https://example.com/page)');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
  });

  it('strips raw HTML: script, img and event handlers never survive', () => {
    const withScript = renderMarkdown('本文です\n\n<script>alert(1)</script>');
    expect(withScript).toContain('本文です');
    expect(withScript).not.toContain('<script');
    expect(withScript).not.toContain('alert');

    const withImg = renderMarkdown('![代替](https://example.com/x.png) と <img src="https://example.com/y.png" onerror="alert(1)">');
    expect(withImg).not.toContain('<img');

    const withHandler = renderMarkdown('<a href="https://example.com" onclick="alert(1)">リンク</a>');
    expect(withHandler).not.toContain('onclick');
    expect(withHandler).not.toContain('alert');
  });

  it('drops dangerous link schemes', () => {
    const html = renderMarkdown('[悪](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('alert');
  });

  it('tolerates non-string input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });
});
