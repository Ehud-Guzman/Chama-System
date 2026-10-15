// The WhatsApp link for a member email does not reach.
import test from 'node:test';
import assert from 'node:assert/strict';

import { whatsappNumber, whatsappLink } from '../src/utils/whatsapp.js';

test('every way of writing a Kenyan number comes out the same', () => {
  for (const written of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678', '+254 712-345-678']) {
    assert.equal(whatsappNumber(written), '254712345678', written);
  }
  assert.equal(whatsappNumber('0112345678'), '254112345678', 'the 01 numbers too');
});

test('something that is not a plausible number gives nothing, never a chat with a stranger', () => {
  for (const bad of ['', null, undefined, '12345', '0212345678', '+44 7700 900123', 'not a number', '07123456']) {
    assert.equal(whatsappNumber(bad), null, String(bad));
  }
});

test('the link carries the number and the words, safely encoded', () => {
  const link = whatsappLink('0712345678', 'Hello Jane, Ksh 400 & thanks');
  assert.equal(link, 'https://wa.me/254712345678?text=Hello%20Jane%2C%20Ksh%20400%20%26%20thanks');
  assert.equal(whatsappLink('nonsense', 'hi'), null);
});
