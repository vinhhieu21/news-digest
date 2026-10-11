// VND formatting, HTML escaping and all user-facing message templates (Vietnamese).
// Every function here is pure; callers pass in data already read from D1.

import { categoryLabel } from "../ai/categories";
import { formatDayMonth, type YearMonth } from "../time";

export interface MemberName {
  user_id: number;
  first_name: string;
  last_name: string | null;
}

export interface MemberTotal extends MemberName {
  total: number;
  count: number;
  max_amount: number;
}

export interface CategoryTotal {
  /** A key from ai/categories.ts, or null when not categorised yet. */
  category: string | null;
  total: number;
}

export interface ExpenseView {
  amount: number;
  note: string;
  spent_on: string;
}

/** 1250000 -> "1.250.000đ" */
export function formatVnd(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = String(Math.abs(Math.trunc(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${digits}đ`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** First name, plus last name for members whose first name is shared within `members`. Escaped. */
export function displayNames(members: MemberName[]): Map<number, string> {
  const names = plainDisplayNames(members);
  for (const [id, name] of names) names.set(id, escapeHtml(name));
  return names;
}

/** Same as displayNames, unescaped (for LLM input). */
export function plainDisplayNames(members: MemberName[]): Map<number, string> {
  const firstNameCounts = new Map<string, number>();
  for (const m of members) firstNameCounts.set(m.first_name, (firstNameCounts.get(m.first_name) ?? 0) + 1);

  const names = new Map<number, string>();
  for (const m of members) {
    const shared = (firstNameCounts.get(m.first_name) ?? 0) > 1;
    names.set(m.user_id, shared && m.last_name ? `${m.first_name} ${m.last_name}` : m.first_name);
  }
  return names;
}

export function addedMessage(opts: {
  expense: ExpenseView;
  name: string;
  today: string;
  month: YearMonth;
  monthTotal: number;
}): string {
  const { expense, name, today, month, monthTotal } = opts;
  const parts = [formatVnd(expense.amount)];
  if (expense.note) parts.push(escapeHtml(expense.note));
  if (expense.spent_on !== today) parts.push(formatDayMonth(expense.spent_on));
  parts.push(escapeHtml(name));
  return `Đã ghi ${parts.join(" · ")}\nTháng ${month.month} của bạn: ${formatVnd(monthTotal)}`;
}

export function undoneMessage(expense: ExpenseView): string {
  const note = expense.note ? ` · ${escapeHtml(expense.note)}` : "";
  return `Đã xoá ${formatVnd(expense.amount)}${note} (${formatDayMonth(expense.spent_on)})`;
}

export function checkMessage(opts: {
  month: YearMonth;
  today: string;
  members: MemberTotal[];
  todayTotal: number;
  monthTotal: number;
}): string {
  const { month, today, members, todayTotal, monthTotal } = opts;
  const header = `Chi tiêu tháng ${month.month} (đến ${formatDayMonth(today)})`;
  if (members.length === 0) return `${header}\nChưa có khoản chi nào.`;
  return [
    header,
    ...rankedLines(members, (m) => `${formatVnd(m.total)} (${m.count} lần)`),
    `Hôm nay: ${formatVnd(todayTotal)} · Cả nhóm: ${formatVnd(monthTotal)}`,
  ].join("\n");
}

export function summaryMessage(opts: {
  month: YearMonth;
  members: MemberTotal[];
  previousTotal: number;
  categories?: CategoryTotal[];
  previousCategories?: CategoryTotal[];
  /** undefined = not requested; null = requested but unavailable (said so in the message). */
  commentary?: string | null;
}): string {
  const { month, members, previousTotal, categories = [], previousCategories = [], commentary } = opts;
  const header = `<b>Tổng kết tháng ${month.month}/${month.year}</b>`;
  if (members.length === 0) return `${header}\nKhông có khoản chi nào.`;

  const total = members.reduce((sum, m) => sum + m.total, 0);
  const prev = month.month === 1 ? 12 : month.month - 1;
  const lines = [
    header,
    ...rankedLines(members, (m) => `${formatVnd(m.total)} (${m.count} lần, lớn nhất ${formatVnd(m.max_amount)})`),
    `Cả nhóm: ${formatVnd(total)} · so với tháng ${prev}: ${percentChange(total, previousTotal)}`,
  ];

  // Skip the section while nothing is categorised (e.g. LLM disabled).
  if (categories.some((c) => c.category !== null)) {
    const previousByKey = new Map(previousCategories.map((c) => [c.category, c.total]));
    lines.push("", "<b>Theo loại</b>");
    for (const c of categories) {
      const change = c.category === null ? "—" : percentChange(c.total, previousByKey.get(c.category) ?? 0);
      lines.push(`${categoryLabel(c.category)}: ${formatVnd(c.total)}${change === "—" ? "" : ` (${change})`}`);
    }
  }

  if (commentary) lines.push("", "<b>Nhận xét</b>", escapeHtml(commentary));
  else if (commentary === null) lines.push("", "<i>Không tạo được nhận xét tháng này.</i>");
  return lines.join("\n");
}

export function dailyRecapMessage(opts: {
  today: string;
  members: MemberTotal[];
  monthTotal: number;
}): string {
  const { today, members, monthTotal } = opts;
  const todayTotal = members.reduce((sum, m) => sum + m.total, 0);
  return [
    `<b>Chi tiêu hôm nay (${formatDayMonth(today)})</b>`,
    ...rankedLines(members, (m) => formatVnd(m.total)),
    `Cả nhóm hôm nay: ${formatVnd(todayTotal)} · Từ đầu tháng: ${formatVnd(monthTotal)}`,
  ].join("\n");
}

export function percentChange(current: number, previous: number): string {
  if (previous === 0) return "—";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export const USAGE = {
  add: "Cách dùng: /add &lt;số tiền&gt; [ghi chú] [hôm qua | dd/mm]\nVí dụ: /add 50k cafe sáng",
  summary: "Cách dùng: /summary [tháng] [năm]\nVí dụ: /summary 9",
  daily: "Cách dùng: /daily on hoặc /daily off",
} as const;

export const ADD_ERRORS = {
  missing: USAGE.add,
  invalid: `Số tiền không hợp lệ (số tiền phải đứng đầu).\n${USAGE.add}`,
  needs_unit: "Số tiền quá nhỏ. Ý bạn là 50k? Hãy ghi rõ đơn vị, ví dụ: /add 50k cafe",
  out_of_range: "Số tiền phải từ 1.000đ đến 100.000.000đ.",
  invalid_date: "Ngày không hợp lệ. Dùng dd/mm (ví dụ 05/10) hoặc \"hôm qua\".",
} as const;

export const HELP_MESSAGE = [
  "<b>Các lệnh</b>",
  "/add 50k cafe sáng — ghi một khoản chi (thêm \"hôm qua\" hoặc 05/10 để đổi ngày)",
  "/check — tổng chi từ đầu tháng",
  "/summary 9 — tổng kết một tháng",
  "/undo — xoá khoản chi gần nhất của bạn (trả lời tin nhắn /add để xoá đúng khoản đó)",
  "/daily on — bật/tắt tổng kết lúc 21:00",
  "/help — xem hướng dẫn",
].join("\n");

export const UNDO_NOT_YOURS =
  "Tin nhắn này không phải khoản chi của bạn nên không xoá gì. Hãy trả lời đúng tin nhắn /add của bạn.";
export const DM_NOTICE = "Bot này chỉ hoạt động trong nhóm.";
export const GENERIC_ERROR = "Có lỗi, thử lại sau";

function rankedLines(members: MemberTotal[], detail: (m: MemberTotal) => string): string[] {
  const names = displayNames(members);
  return members.map((m, i) => `${i + 1}. ${names.get(m.user_id)}: ${detail(m)}`);
}
