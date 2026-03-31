import '@testing-library/jest-dom'

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false }
  })
}

if (!globalThis.scrollTo) {
  globalThis.scrollTo = () => {}
}

if (globalThis.HTMLElement && !globalThis.HTMLElement.prototype.scrollIntoView) {
  globalThis.HTMLElement.prototype.scrollIntoView = () => {}
}

if (globalThis.HTMLElement && !globalThis.HTMLElement.prototype.scrollTo) {
  globalThis.HTMLElement.prototype.scrollTo = () => {}
}
