import type { BookingStatus } from '@bookking/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { assertTransition, canTransition } from '../src/modules/bookings/state.js';

describe('booking state transitions', () => {
  it('allows the expected transitions', () => {
    expect(canTransition('draft', 'confirmed')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('confirmed', 'completed')).toBe(true);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
  });

  it.each<[BookingStatus, BookingStatus]>([
    ['draft', 'completed'],
    ['completed', 'draft'],
    ['completed', 'confirmed'],
    ['completed', 'cancelled'],
    ['cancelled', 'draft'],
    ['cancelled', 'confirmed'],
    ['cancelled', 'completed']
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(AppError);
  });

  it('exposes a 409 error with the attempted transition', () => {
    try {
      assertTransition('completed', 'cancelled');
      throw new Error('Expected assertTransition to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 409,
        code: 'invalid_transition',
        details: { from: 'completed', to: 'cancelled' }
      });
    }
  });
});
