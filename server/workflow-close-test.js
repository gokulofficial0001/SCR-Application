const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let currentUser = { id: 'admin-1', name: 'Administrator', role: 'admin' };
let scr = {
  id: 'scr-1',
  scrNumber: '174',
  status: 'On Hold',
  currentStage: 1,
  createdBy: 'requester-1',
  updatedAt: 'before-close',
  assignedDeveloper: 'developer-1'
};
const stages = [{ id: 'stage-1', scrId: scr.id, stage: 1, exitedAt: null }];
const auditEntries = [];
const notifications = [];

const Store = {
  getById(collection, id) {
    if (collection === 'scr_requests' && id === scr.id) return scr;
    return null;
  },
  filter(collection, predicate) {
    return collection === 'workflow_stages' ? stages.filter(predicate) : [];
  },
  update(collection, id, updates) {
    const item = collection === 'scr_requests' ? scr : stages.find(stage => stage.id === id);
    if (!item) return null;
    if (collection === 'scr_requests') {
      scr = { ...item, ...updates };
      return scr;
    }
    Object.assign(item, updates);
    return item;
  }
};

const context = {
  Auth: { currentUser: () => currentUser },
  Store,
  Utils: { nowISO: () => 'after-close', today: () => '2026-11-20' },
  Audit: { log: (...entry) => auditEntries.push(entry) },
  Notifications: {
    create: (...notification) => notifications.push(notification),
    updateBadge() {}
  },
  console
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'workflow.js'), 'utf8') +
    '\nthis.__Workflow = Workflow;',
  context
);
const Workflow = context.__Workflow;

assert.equal(Workflow.canClose(scr), true, 'admin can close an on-hold SCR before stage 6');
assert.equal(Workflow.canClose({ ...scr, status: 'Closed' }), false);
assert.equal(Workflow.canClose({ ...scr, status: 'Rejected' }), false);
assert.equal(Workflow.canClose({ ...scr, currentStage: 7 }), false);

const result = Workflow.closeTicket(scr.id);
assert.equal(result.success, true);
assert.equal(scr.status, 'Closed');
assert.equal(stages[0].action, 'Closed');
assert.equal(stages[0].exitedBy, currentUser.id);
assert.deepEqual(auditEntries[0].slice(3, 6), ['status', 'On Hold', 'Closed']);
assert.match(notifications[0][1], /has been closed$/);
assert.match(notifications[1][1], /has been closed by Administrator$/);

currentUser = { id: 'impl-1', name: 'Implementation', role: 'implementation' };
assert.equal(Workflow.canClose({ currentStage: 1, status: 'Open' }), false);
assert.equal(Workflow.canClose({ currentStage: 6, status: 'Open' }), true);
assert.equal(Workflow.canClose({ currentStage: 6, status: 'On Hold' }), false);

console.log('Workflow close tests passed.');
