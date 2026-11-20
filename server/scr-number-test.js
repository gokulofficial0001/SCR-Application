const assert = require('node:assert/strict');
const { allocateSCRNumber } = require('./scr-number');

function createMockDb(scrNumbers, initialLastNumber) {
  let lastNumber = initialLastNumber;
  return {
    prepare(sql) {
      if (sql === 'SELECT data FROM scr_requests') {
        return { all: () => scrNumbers.map(scrNumber => ({ data: JSON.stringify({ scrNumber }) })) };
      }
      if (sql === 'SELECT last_number FROM scr_number_sequence WHERE id = 1') {
        return { get: () => lastNumber == null ? undefined : { last_number: lastNumber } };
      }
      if (sql === 'INSERT OR REPLACE INTO scr_number_sequence (id, last_number) VALUES (1, ?)') {
        return { run: number => { lastNumber = number; } };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
    getLastNumber() { return lastNumber; },
    setSCRNumbers(numbers) { scrNumbers = numbers; }
  };
}

const db = createMockDb(['171', '171', '172', '47.1', ''], null);
assert.equal(allocateSCRNumber(db), '173');
assert.equal(db.getLastNumber(), 173);

db.setSCRNumbers(['171', '47.1']);
assert.equal(allocateSCRNumber(db), '174');
assert.equal(db.getLastNumber(), 174);

assert.equal(allocateSCRNumber(createMockDb([], null)), '147');

console.log('SCR number allocation tests passed.');
