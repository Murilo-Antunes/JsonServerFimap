/**
 * Datas no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
 * O servidor (Render) roda em UTC, então "hoje" e "este mês" precisam ser calculados em UTC-3.
 */
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Aceita datetime ISO ou só a data (YYYY-MM-DD, tratada como 00:00 de Brasília). */
function parseDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00-03:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO cujos campos (YYYY-MM-DDTHH:mm...) representam o horário local de Brasília. */
const toLocalIso = (date) => new Date(date.getTime() + TZ_OFFSET_MS).toISOString();
const dayOf = (localIso) => localIso.slice(0, 10);
const monthOf = (localIso) => localIso.slice(0, 7);
const hourOf = (localIso) => Number(localIso.slice(11, 13));

function previousMonth(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

const daysBetween = (fromDay, toDay) =>
  Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);

module.exports = {
  TZ_OFFSET_MS,
  DAY_MS,
  parseDate,
  toLocalIso,
  dayOf,
  monthOf,
  hourOf,
  previousMonth,
  daysBetween,
};
