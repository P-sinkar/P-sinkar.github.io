// In-panel dialogs that replace the browser's prompt()/confirm()/alert() boxes, which look
// out of place in a side panel and aren't reliable there. Built on the native <dialog> element:
// Escape cancels, Enter confirms, focus stays inside while open.

function uiDialog({ title, message, input, buttons }) {
  return new Promise(resolve => {
    const dlg = document.createElement("dialog");
    dlg.className = "ui-dialog";

    const form = document.createElement("form");
    form.method = "dialog";

    if (title) {
      const h = document.createElement("h2");
      h.textContent = title;
      form.appendChild(h);
    }
    if (message) {
      const p = document.createElement("p");
      p.textContent = message;
      form.appendChild(p);
    }

    let field = null;
    if (input) {
      field = document.createElement(input.multiline ? "textarea" : "input");
      if (!input.multiline) field.type = "text";
      field.value = input.value || "";
      field.placeholder = input.placeholder || "";
      if (input.multiline) field.rows = input.rows || 6;
      field.className = "ui-dialog-field";
      form.appendChild(field);
    }

    const row = document.createElement("div");
    row.className = "ui-dialog-buttons";
    let defaultValue = null;
    buttons.forEach(b => {
      const btn = document.createElement("button");
      btn.type = b.primary ? "submit" : "button";
      btn.textContent = b.label;
      btn.className = b.primary ? (b.danger ? "danger" : "primary") : "plain";
      if (b.primary) defaultValue = b.value;
      btn.addEventListener("click", ev => {
        if (b.primary) return; // handled by submit
        ev.preventDefault();
        finish(b.value);
      });
      row.appendChild(btn);
    });
    form.appendChild(row);
    dlg.appendChild(form);

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      const out = field ? { value, text: field.value } : value;
      dlg.close();
      dlg.remove();
      resolve(out);
    }

    form.addEventListener("submit", ev => {
      ev.preventDefault();
      if (field && !input.multiline && input.required && !field.value.trim()) { field.focus(); return; }
      finish(defaultValue);
    });
    // Enter in a multi-line field adds a line; Ctrl/Cmd+Enter saves.
    if (field && input.multiline) {
      field.addEventListener("keydown", ev => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); form.requestSubmit(); }
      });
    }
    dlg.addEventListener("cancel", ev => { ev.preventDefault(); finish(null); });

    document.body.appendChild(dlg);
    dlg.showModal();
    if (field) { field.focus(); if (!input.multiline) field.select(); }
    else { const main = row.querySelector("button.primary, button.danger"); if (main) main.focus(); } // Enter = main action
  });
}

// Returns the entered text (trimmed), or null if cancelled / left empty.
async function uiPrompt(title, { value = "", placeholder = "", okLabel = "Save", message = "" } = {}) {
  const r = await uiDialog({
    title, message,
    input: { value, placeholder, required: true },
    buttons: [{ label: "Cancel", value: "cancel" }, { label: okLabel, value: "ok", primary: true }]
  });
  if (!r || r.value !== "ok") return null;
  const t = r.text.trim();
  return t || null;
}

// Returns the full text of a multi-line field, or null if cancelled.
async function uiPromptLines(title, { value = "", message = "", okLabel = "Save" } = {}) {
  const r = await uiDialog({
    title, message,
    input: { value, multiline: true },
    buttons: [{ label: "Cancel", value: "cancel" }, { label: okLabel, value: "ok", primary: true }]
  });
  return r && r.value === "ok" ? r.text : null;
}

async function uiConfirm(message, { title = "", okLabel = "OK", danger = false } = {}) {
  const r = await uiDialog({
    title, message,
    buttons: [{ label: "Cancel", value: false }, { label: okLabel, value: true, primary: true, danger }]
  });
  return r === true;
}

// choices: [{ label, value }] — the last one is the default (Enter). Returns value or null.
async function uiChoose(message, choices, { title = "" } = {}) {
  const buttons = [{ label: "Cancel", value: null }].concat(
    choices.map((c, i) => ({ label: c.label, value: c.value, primary: i === choices.length - 1 }))
  );
  return uiDialog({ title, message, buttons });
}
