// Shared confirmation for the Services form and native service menu destination.
export function confirmServiceRemoval(name: string): Promise<boolean> {
  if (document.querySelector("dialog[open]")) return Promise.resolve(false);
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "confirmation-dialog";
  dialog.setAttribute("aria-labelledby", "remove-service-title");
  dialog.setAttribute("aria-describedby", "remove-service-description");
  const title = document.createElement("h2");
  title.id = "remove-service-title";
  title.textContent = "Remove service?";
  const description = document.createElement("p");
  description.id = "remove-service-description";
  description.textContent = `Remove “${name || "this service"}” from ChatPlus Desktop? Your stored profile is retained. This does not leave or delete a server at the provider.`;
  const actions = document.createElement("div");
  actions.className = "actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary danger";
  remove.textContent = "Remove service";
  actions.append(cancel, remove);
  dialog.append(title, description, actions);
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (accepted: boolean) => {
      if (finished) return;
      finished = true;
      dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(accepted);
    };
    cancel.addEventListener("click", () => finish(false));
    remove.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        finish(false);
    });
    try {
      dialog.showModal();
      cancel.focus();
    } catch (error) {
      dialog.remove();
      reject(error);
    }
  });
}
