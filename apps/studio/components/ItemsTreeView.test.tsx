// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ItemsTreeView } from './ItemsTreeView';

describe('ItemsTreeView', () => {
  it('applies its layout class to the ScrollArea root without leaking component props', () => {
    const { container } = render(
      <ItemsTreeView rootClassName="tree-root">
        <div>Item</div>
      </ItemsTreeView>,
    );

    const viewport = container.querySelector('.bb-scroll-area__viewport');

    expect(container.firstElementChild?.classList.contains('tree-root')).toBe(true);
    expect(viewport?.hasAttribute('rootClassName')).toBe(false);
    expect(viewport?.hasAttribute('containerClassName')).toBe(false);
  });
});
