import React from 'react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

/**
 * In-memory router wrapper for component tests.
 *
 * wouter 3 dropped the `MemoryRouter` export in favour of `Router` + a location hook;
 * importing the old name yields `undefined`, which React reports as the unhelpful
 * "Element type is invalid" and takes the whole tree down.
 */
export const TestRouter: React.FC<{ children: React.ReactNode; path?: string }> = ({
  children,
  path = '/',
}) => {
  const [{ hook }] = React.useState(() => memoryLocation({ path }));
  return <Router hook={hook}>{children}</Router>;
};
