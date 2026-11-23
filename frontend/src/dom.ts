export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element: ${id}`);
  return value as T;
}
export function optEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  item.textContent = text;
  item.className = className;
  return item;
}
export function action(
  text: string,
  handler: () => void,
  className = "button ghost",
) {
  const button = node("button", text, className);
  button.type = "button";
  button.onclick = handler;
  return button;
}
export function download(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const a = node("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export async function dialog(
  title: string,
  description: string,
  options: { label: string; value: string; danger?: boolean }[],
  input?: string,
): Promise<{ value: string; text: string }> {
  const modal = el<HTMLDialogElement>("modal");
  const previous = document.activeElement as HTMLElement | null;
  el("modal-title").textContent = title;
  el("modal-description").textContent = description;
  const field = el<HTMLInputElement>("modal-input");
  field.hidden = input === undefined;
  field.value = input || "";
  const buttons = el("modal-actions");
  buttons.replaceChildren();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      const text = field.value.trim();
      field.value = "";
      modal.close();
      previous?.focus();
      resolve({ value, text });
    };
    for (const option of options)
      buttons.append(
        action(
          option.label,
          () => finish(option.value),
          `button ${option.danger ? "danger" : option.value === "cancel" ? "secondary" : "primary"}`,
        ),
      );
    modal.oncancel = (event) => {
      event.preventDefault();
      finish("cancel");
    };
    modal.onclose = () => finish("cancel");
    modal.showModal();
    (input !== undefined ? field : buttons.querySelector("button"))?.focus();
  });
}
