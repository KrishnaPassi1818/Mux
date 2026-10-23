import { formatDuration, formatPercent } from './format';

export interface EvaluationItemResult {
  id: string;
  prompt: string;
  category: string;
  // Router run
  router: {
    model: string;
    tier: string;
    intent?: string | undefined;
    score?: number | undefined;
    cache: string;
    latency_ms: number;
    ttft_ms: number;
    tokens_per_sec: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    output_preview?: string | undefined;
    error?: string | undefined;
  };
  // Heavy run
  heavy: {
    model: string;
    tier: string;
    cache: string;
    latency_ms: number;
    ttft_ms: number;
    tokens_per_sec: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    output_preview?: string | undefined;
    error?: string | undefined;
  };
  // Comparison
  latency_saved_ms: number;
  latency_reduction_pct: number;
  tokens_diff: number; // heavy tokens - router tokens (positive = router saved tokens or less overhead)
}

export interface EvaluationReport {
  id: string;
  created_at: string;
  test_count: number;
  heavy_model_used: string;
  summary: {
    // Latency
    router_avg_latency_ms: number;
    heavy_avg_latency_ms: number;
    latency_reduction_pct: number;
    router_p50_latency_ms: number;
    heavy_p50_latency_ms: number;
    // Tokens
    router_total_prompt_tokens: number;
    router_total_completion_tokens: number;
    router_total_tokens: number;
    heavy_total_prompt_tokens: number;
    heavy_total_completion_tokens: number;
    heavy_total_tokens: number;
    token_usage_diff: number;
    token_usage_diff_pct: number;
    // Throughput
    router_avg_tok_per_sec: number;
    heavy_avg_tok_per_sec: number;
    // Tier distribution in router
    tier_counts: {
      light: number;
      code: number;
      heavy: number;
    };
    // Efficiency verdict
    efficiency_score: number; // 0-100 score
    verdict: string;
  };
  items: EvaluationItemResult[];
}

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportEvaluationJson = (report: EvaluationReport): void => {
  const jsonStr = JSON.stringify(report, null, 2);
  downloadBlob(new Blob([jsonStr], { type: 'application/json' }), `evaluation-report-${report.id}.json`);
};

export const exportEvaluationCsv = (report: EvaluationReport): void => {
  const headers = [
    'Test #',
    'ID',
    'Category',
    'Prompt',
    'Router Tier',
    'Router Model',
    'Router Latency (ms)',
    'Router TTFT (ms)',
    'Router Tokens/sec',
    'Router Prompt Tok',
    'Router Compl Tok',
    'Router Total Tok',
    'Heavy Model',
    'Heavy Latency (ms)',
    'Heavy TTFT (ms)',
    'Heavy Tokens/sec',
    'Heavy Prompt Tok',
    'Heavy Compl Tok',
    'Heavy Total Tok',
    'Latency Saved (ms)',
    'Latency Reduction %',
    'Token Difference',
  ];

  const rows = report.items.map((item, idx) => [
    idx + 1,
    `"${item.id}"`,
    `"${item.category}"`,
    `"${item.prompt.replace(/"/g, '""')}"`,
    item.router.tier,
    `"${item.router.model}"`,
    item.router.latency_ms.toFixed(1),
    item.router.ttft_ms.toFixed(1),
    item.router.tokens_per_sec.toFixed(1),
    item.router.prompt_tokens,
    item.router.completion_tokens,
    item.router.total_tokens,
    `"${item.heavy.model}"`,
    item.heavy.latency_ms.toFixed(1),
    item.heavy.ttft_ms.toFixed(1),
    item.heavy.tokens_per_sec.toFixed(1),
    item.heavy.prompt_tokens,
    item.heavy.completion_tokens,
    item.heavy.total_tokens,
    item.latency_saved_ms.toFixed(1),
    `${item.latency_reduction_pct.toFixed(1)}%`,
    item.tokens_diff,
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `evaluation-report-${report.id}.csv`);
};

interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
}

export const exportEvaluationPdf = (report: EvaluationReport): void => {
  const pages: string[] = [];
  let currentLines: PdfLine[] = [];

  const addLine = (text: string, bold = false, size = 9) => {
    if (currentLines.length >= 44) {
      pages.push(renderPageStream(currentLines));
      currentLines = [];
    }
    currentLines.push({ text, bold, size });
  };

  const renderPageStream = (lines: PdfLine[]): string => {
    let stream = 'BT\n';
    let y = 800;
    for (const item of lines) {
      const font = item.bold ? '/F2' : '/F1';
      const size = item.size ?? 9;
      const escaped = item.text.replace(/[\\()]/g, (c) => `\\${c}`);
      stream += `${font} ${size} Tf\n35 ${y} Td\n(${escaped}) Tj\nET\nBT\n`;
      y -= size + 4;
    }
    stream += 'ET\n';
    return stream;
  };

  addLine('EVALUATION REPORT: ROUTER AUTO-SELECTION VS HEAVY-ONLY LLM', true, 14);
  addLine(`Generated: ${new Date().toISOString()}  |  Run ID: ${report.id}  |  Tests: ${report.test_count}`, false, 8);
  addLine('---------------------------------------------------------------------------------------------------', false, 8);
  addLine('', false, 4);

  addLine('1. EXECUTIVE SUMMARY & EFFICIENCY VERDICT', true, 11);
  addLine(`Verdict: ${report.summary.verdict}`, false, 9);
  addLine(`Efficiency Score: ${report.summary.efficiency_score.toFixed(1)} / 100`, true, 9);
  addLine(`Heavy Baseline Model: ${report.heavy_model_used}`, false, 9);
  addLine('', false, 4);

  addLine('2. LATENCY & THROUGHPUT COMPARISON', true, 11);
  addLine(`• Router Mean Latency: ${formatDuration(report.summary.router_avg_latency_ms)} (p50: ${formatDuration(report.summary.router_p50_latency_ms)})`, false, 9);
  addLine(`• Heavy-Only Mean Latency: ${formatDuration(report.summary.heavy_avg_latency_ms)} (p50: ${formatDuration(report.summary.heavy_p50_latency_ms)})`, false, 9);
  addLine(`• Latency Reduction: ${report.summary.latency_reduction_pct.toFixed(1)}% efficiency gain`, true, 9);
  addLine(`• Average Tokens/Sec: Router ${report.summary.router_avg_tok_per_sec.toFixed(1)} tok/s vs Heavy ${report.summary.heavy_avg_tok_per_sec.toFixed(1)} tok/s`, false, 9);
  addLine('', false, 4);

  addLine('3. TOKEN USAGE & DIFFERENCE', true, 11);
  addLine(`• Router Tokens: ${report.summary.router_total_tokens} total (${report.summary.router_total_prompt_tokens} prompt + ${report.summary.router_total_completion_tokens} completion)`, false, 9);
  addLine(`• Heavy Tokens:  ${report.summary.heavy_total_tokens} total (${report.summary.heavy_total_prompt_tokens} prompt + ${report.summary.heavy_total_completion_tokens} completion)`, false, 9);
  const tokDiff = report.summary.token_usage_diff;
  const tokPct = report.summary.token_usage_diff_pct;
  const tokSign = tokDiff >= 0 ? 'fewer' : 'more';
  addLine(`• Token Usage Difference: Router used ${Math.abs(tokDiff)} ${tokSign} tokens (${Math.abs(tokPct).toFixed(1)}% difference)`, true, 9);
  addLine('', false, 4);

  addLine('4. ROUTER TIER DISTRIBUTION', true, 11);
  const tc = report.summary.tier_counts;
  const total = report.test_count || 1;
  addLine(`• Light Tier: ${tc.light} (${formatPercent(tc.light / total, true)})`, false, 9);
  addLine(`• Code Tier:  ${tc.code} (${formatPercent(tc.code / total, true)})`, false, 9);
  addLine(`• Heavy Tier: ${tc.heavy} (${formatPercent(tc.heavy / total, true)})`, false, 9);
  addLine('', false, 4);

  addLine('5. DETAILED TEST CASE BREAKDOWN (Top Cases)', true, 11);
  addLine(pad('Test ID', 14) + pad('Router Tier', 12) + pad('R-Lat(ms)', 12) + pad('H-Lat(ms)', 12) + pad('Saved(ms)', 12) + pad('Eff %', 10) + pad('Tok Diff', 10), true, 8);
  addLine('---------------------------------------------------------------------------------------------------', false, 8);

  for (const item of report.items) {
    const row = pad(item.id, 14) +
      pad(item.router.tier, 12) +
      pad(item.router.latency_ms.toFixed(0), 12) +
      pad(item.heavy.latency_ms.toFixed(0), 12) +
      pad(item.latency_saved_ms.toFixed(0), 12) +
      pad(`${item.latency_reduction_pct.toFixed(0)}%`, 10) +
      pad(String(item.tokens_diff), 10);
    addLine(row, false, 8);
  }

  if (currentLines.length > 0) {
    pages.push(renderPageStream(currentLines));
  }

  const pdfBytes = assemblePdfDocument(pages);
  downloadBlob(new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), `evaluation-report-${report.id}.pdf`);
};

const pad = (str: string, width: number): string => {
  if (str.length >= width) return str.slice(0, width - 1) + ' ';
  return str + ' '.repeat(width - str.length);
};

const assemblePdfDocument = (pages: string[]): Uint8Array => {
  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const fontRegularIndex = 3;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldIndex = 4;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  for (let i = 0; i < pages.length; i++) {
    const pageIndex = 5 + i * 2;
    const contentIndex = pageIndex + 1;
    const streamContent = pages[i] ?? '';
    const streamLen = new TextEncoder().encode(streamContent).length;
    addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentIndex} 0 R /Resources << /Font << /F1 ${fontRegularIndex} 0 R /F2 ${fontBoldIndex} 0 R >> >> >>`);
    addObject(`<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < objects.length; i++) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += offset.toString().padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  return encoder.encode(pdf);
};
