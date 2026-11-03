const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validEmail } = require('../email-validation.js');
test('email validation rejects incomplete and malformed addresses', () => {
  for (const value of ['user', 'user@', 'user@example', 'user@example.c', '.user@example.com', 'user..name@example.com',
    'user@example..com', 'user@-example.com', 'user@example-.com', 'a@@example.com', 'user name@example.com', 'a@b.123',
    ' user@example.com', 'a'.repeat(65) + '@example.com', 'user@' + 'x'.repeat(64) + '.com']) {
    assert.equal(validEmail(value), false, value);
  }
});
test('email validation accepts complete addresses without claiming ownership verification', () => {
  for (const value of ['user@example.com', 'first.last+qa@team.example.co.in', "o'name@example.org", 'USER@EXAMPLE.COM']) {
    assert.equal(validEmail(value), true, value);
  }
});
