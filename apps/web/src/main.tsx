/**
 * Entry point. The page is mounted into the single root element that `index.html` provides.
 */

import { render } from 'preact';
import { App } from './app.tsx';

const root = document.getElementById('root');
if (root === null) {
  // Nothing else can be done: the page has no mount point.
  console.error('Orchescope: no element with the identifier "root" was found in this document.');
} else {
  render(<App />, root);
}
