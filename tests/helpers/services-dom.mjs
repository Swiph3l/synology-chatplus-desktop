// LinkeDOM omits native dialog, focus, form validity and pointer-capture APIs.
// These shims exercise our event handlers; real browser behavior needs runtime QA.
export function servicesDom(window, document) {
  let focused = document.body;
  const frames = new Map();
  let frameId = 0;
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => focused,
  });
  document.hasFocus = () => true;
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.focus = function () {
    focused = this;
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLInputElement.prototype.select = () => {};
  window.HTMLInputElement.prototype.setCustomValidity = function (message) {
    this.validationMessage = message;
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const index = this.classList.contains("service-card")
      ? [...this.parentNode.children].indexOf(this)
      : 0;
    const top = index * 80;
    return {
      left: 0,
      right: 600,
      top,
      bottom: this.classList.contains("service-card") ? top + 72 : 400,
      height: this.classList.contains("service-card") ? 72 : 400,
    };
  };
  window.HTMLElement.prototype.setPointerCapture = function (id) {
    this.capturedPointer = id;
  };
  window.HTMLElement.prototype.hasPointerCapture = function (id) {
    return this.capturedPointer === id;
  };
  window.HTMLElement.prototype.releasePointerCapture = function () {
    delete this.capturedPointer;
  };
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    const element = create(tag);
    if (tag === "dialog") {
      Object.defineProperty(element, "open", {
        get: () => element.hasAttribute("open"),
      });
      element.showModal = () => element.setAttribute("open", "");
      element.close = () => element.removeAttribute("open");
    }
    if (tag === "form")
      element.reportValidity = () =>
        [...element.querySelectorAll("input")].every(
          (input) =>
            input.disabled ||
            (!input.validationMessage && (!input.required || input.value)),
        );
    return element;
  };
  return {
    Event: window.Event,
    HTMLInputElement: window.HTMLInputElement,
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    },
  };
}

export function dispatch(window, element, type, properties = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  element.dispatchEvent(event);
  return event;
}

export function setServiceField(fixture, field, value) {
  const input = fixture.document.getElementById(`service-dialog-${field}`);
  if (typeof value === "boolean") input.checked = value;
  else input.value = value;
  dispatch(
    fixture.window,
    input,
    typeof value === "boolean" ? "change" : "input",
  );
}

export function applyServiceDialog(fixture) {
  dispatch(
    fixture.window,
    fixture.document.querySelector(".service-dialog form"),
    "submit",
  );
}

export function chooseProvider(fixture, provider) {
  const input = fixture.document.getElementById(
    `service-dialog-provider-${provider}`,
  );
  input.checked = true;
  dispatch(fixture.window, input, "change");
}
