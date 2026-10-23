/** Store em memória com a mesma interface de lib/store.js. */
function createMemoryStore(initial = {}) {
  const tables = {};
  Object.entries(initial).forEach(([name, rows]) => { tables[name] = rows.map((r) => ({ ...r })); });
  const table = (name) => (tables[name] = tables[name] || []);
  return {
    tables,
    all: (name) => table(name),
    find: (name, predicate) => table(name).find(predicate),
    insert(name, doc) {
      const rows = table(name);
      const id = rows.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
      const row = { id, ...doc };
      rows.push(row);
      return row;
    },
    update(name, id, patch) {
      const row = table(name).find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return row;
    },
    removeWhere(name, predicate) { tables[name] = table(name).filter((r) => !predicate(r)); },
  };
}
module.exports = { createMemoryStore };
