(function(root) {
  let activeDialog = null;
  let dialogSequence = 0;

  const focusableSelector = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function toText(value) {
    return value == null ? '' : String(value);
  }

  function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent != null) element.textContent = textContent;
    return element;
  }

  function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(focusableSelector))
      .filter(element => !element.disabled && element.getAttribute('aria-hidden') !== 'true');
  }

  function restoreFocus(element) {
    if (!element || !document.contains(element) || typeof element.focus !== 'function') return;
    setTimeout(() => {
      if (!document.contains(element)) return;
      try {
        element.focus({ preventScroll: true });
      } catch (e) {
        element.focus();
      }
    }, 0);
  }

  function normalizeDialogOptions(options, defaults) {
    if (typeof options === 'string') {
      return { ...defaults, message: options };
    }
    return { ...defaults, ...(options || {}) };
  }

  function showPopupDialog(options) {
    const config = normalizeDialogOptions(options, {
      kind: 'confirm',
      title: '请确认',
      message: '',
      primaryText: '确认',
      secondaryText: '取消',
      primaryVariant: 'primary',
      defaultValue: '',
      label: '',
      fields: [],
      validate: null
    });

    if (activeDialog) {
      activeDialog.close(null);
    }

    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialogId = `popup-dialog-${++dialogSequence}`;
      const titleId = `${dialogId}-title`;
      const messageId = `${dialogId}-message`;
      const cancelValue = config.kind === 'confirm' ? false : null;

      const backdrop = createElement('div', 'popup-dialog-backdrop');
      const dialog = createElement('div', 'popup-dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', titleId);

      const title = createElement('h2', 'popup-dialog-title', config.title);
      title.id = titleId;
      dialog.appendChild(title);

      if (config.message) {
        const message = createElement('p', 'popup-dialog-message', config.message);
        message.id = messageId;
        dialog.setAttribute('aria-describedby', messageId);
        dialog.appendChild(message);
      }

      let input = null;
      const formInputs = {};
      let error = null;
      if (config.kind === 'prompt') {
        const field = createElement('label', 'popup-dialog-field');
        const label = createElement('span', 'popup-dialog-label', config.label || config.title);
        input = createElement('input', 'popup-dialog-input');
        input.type = 'text';
        input.value = toText(config.defaultValue);
        field.appendChild(label);
        field.appendChild(input);
        dialog.appendChild(field);
      }
      if (config.kind === 'form') {
        for (const fieldConfig of config.fields || []) {
          const field = createElement('label', 'popup-dialog-field');
          const label = createElement('span', 'popup-dialog-label', fieldConfig.label || fieldConfig.name);
          const fieldInput = createElement('input', 'popup-dialog-input');
          fieldInput.type = fieldConfig.type || 'text';
          fieldInput.name = fieldConfig.name;
          fieldInput.value = toText(fieldConfig.defaultValue);
          if (fieldConfig.placeholder) fieldInput.placeholder = fieldConfig.placeholder;
          fieldInput.addEventListener('input', () => {
            if (error) error.hidden = true;
          });
          formInputs[fieldConfig.name] = fieldInput;
          field.appendChild(label);
          field.appendChild(fieldInput);
          dialog.appendChild(field);
        }

        error = createElement('div', 'popup-dialog-error');
        error.hidden = true;
        error.setAttribute('role', 'alert');
        error.setAttribute('aria-live', 'polite');
        dialog.appendChild(error);
      }

      const actions = createElement('div', 'popup-dialog-actions');
      const secondaryButton = createElement('button', 'popup-dialog-button secondary', config.secondaryText);
      secondaryButton.type = 'button';

      const primaryButton = createElement(
        'button',
        `popup-dialog-button ${config.primaryVariant === 'danger' ? 'danger' : 'primary'}`,
        config.primaryText
      );
      primaryButton.type = 'button';

      let closing = false;
      function close(result) {
        if (activeDialog?.close !== close || closing) return;
        closing = true;
        activeDialog = null;
        document.removeEventListener('keydown', handleKeyDown, true);
        backdrop.classList.remove('is-open');
        backdrop.classList.add('is-closing');

        let finished = false;
        const finishClose = () => {
          if (finished) return;
          finished = true;
          backdrop.removeEventListener('transitionend', finishClose);
          backdrop.remove();
          resolve(result);
          restoreFocus(previousFocus);
        };

        if (root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          finishClose();
          return;
        }

        backdrop.addEventListener('transitionend', finishClose);
        setTimeout(finishClose, 180);
      }

      function confirmPrimary() {
        if (config.kind === 'form') {
          const values = {};
          for (const [name, fieldInput] of Object.entries(formInputs)) {
            values[name] = fieldInput.value;
          }

          const validationMessage = typeof config.validate === 'function'
            ? config.validate(values)
            : null;
          if (validationMessage) {
            error.textContent = validationMessage;
            error.hidden = false;
            return;
          }

          close(values);
          return;
        }
        if (config.kind === 'prompt') {
          close(input.value);
          return;
        }
        if (config.kind === 'choice') {
          close('primary');
          return;
        }
        close(true);
      }

      function confirmSecondary() {
        if (config.kind === 'choice') {
          close('secondary');
          return;
        }
        close(cancelValue);
      }

      function handleKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(cancelValue);
          return;
        }

        if (event.key === 'Enter' && event.target?.tagName === 'INPUT' && (input || config.kind === 'form')) {
          event.preventDefault();
          confirmPrimary();
          return;
        }

        if (event.key !== 'Tab') return;

        const focusable = getFocusableElements(dialog);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      secondaryButton.addEventListener('click', confirmSecondary);
      primaryButton.addEventListener('click', confirmPrimary);
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) {
          close(cancelValue);
        }
      });

      actions.appendChild(secondaryButton);
      actions.appendChild(primaryButton);
      dialog.appendChild(actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      activeDialog = { close };
      document.addEventListener('keydown', handleKeyDown, true);
      requestAnimationFrame(() => {
        if (activeDialog?.close !== close || closing) return;
        backdrop.classList.add('is-open');
      });

      const initialFocus = input || Object.values(formInputs)[0] || (config.primaryVariant === 'danger' ? secondaryButton : primaryButton);
      restoreFocus(initialFocus);
    });
  }

  function showPopupConfirm(options) {
    const config = normalizeDialogOptions(options, {
      title: '请确认',
      message: '',
      primaryText: '确认',
      secondaryText: '取消',
      primaryVariant: 'primary'
    });

    return showPopupDialog({
      kind: 'confirm',
      title: config.title,
      message: config.message,
      primaryText: config.confirmText || config.primaryText,
      secondaryText: config.cancelText || config.secondaryText,
      primaryVariant: config.danger ? 'danger' : config.primaryVariant
    });
  }

  function showPopupPrompt(options) {
    const config = normalizeDialogOptions(options, {
      title: '请输入',
      message: '',
      label: '',
      defaultValue: '',
      primaryText: '保存',
      secondaryText: '取消'
    });

    return showPopupDialog({
      kind: 'prompt',
      title: config.title,
      message: config.message,
      label: config.label,
      defaultValue: config.defaultValue,
      primaryText: config.confirmText || config.primaryText,
      secondaryText: config.cancelText || config.secondaryText
    });
  }

  function showPopupChoice(options) {
    const config = normalizeDialogOptions(options, {
      title: '请选择',
      message: '',
      primaryText: '确认',
      secondaryText: '取消',
      primaryVariant: 'primary'
    });

    return showPopupDialog({
      kind: 'choice',
      title: config.title,
      message: config.message,
      primaryText: config.primaryText,
      secondaryText: config.secondaryText,
      primaryVariant: config.primaryVariant
    });
  }

  function showPopupForm(options) {
    const config = normalizeDialogOptions(options, {
      title: '修改',
      message: '',
      fields: [],
      primaryText: '保存',
      secondaryText: '取消',
      validate: null
    });

    return showPopupDialog({
      kind: 'form',
      title: config.title,
      message: config.message,
      fields: config.fields,
      validate: config.validate,
      primaryText: config.confirmText || config.primaryText,
      secondaryText: config.cancelText || config.secondaryText
    });
  }

  root.showPopupDialog = showPopupDialog;
  root.showPopupConfirm = showPopupConfirm;
  root.showPopupPrompt = showPopupPrompt;
  root.showPopupChoice = showPopupChoice;
  root.showPopupForm = showPopupForm;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      showPopupDialog,
      showPopupConfirm,
      showPopupPrompt,
      showPopupChoice,
      showPopupForm
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
