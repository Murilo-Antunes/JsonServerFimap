/**
 * Camada fina sobre o lowdb do json-server. Rotas e serviços falam só com esta interface
 * (all/find/insert/update/removeWhere), então trocar o banco no futuro mexe em um arquivo só.
 */
function createStore(db) {
  return {
    all: (name) => db.get(name).value() || [],
    find: (name, predicate) => db.get(name).find(predicate).value(),
    insert: (name, doc) => db.get(name).insert(doc).write(),
    update: (name, id, patch) => db.get(name).find({ id }).assign(patch).write(),
    removeWhere: (name, predicate) => db.get(name).remove(predicate).write(),
  };
}

/** Garante que as coleções usadas pela API existam (db.json antigo pode não tê-las). */
function ensureCollections(db, names) {
  names.forEach((name) => {
    if (!Array.isArray(db.get(name).value())) db.set(name, []).write();
  });
}

module.exports = { createStore, ensureCollections };
