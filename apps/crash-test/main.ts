import "@brasos/sdk";

document.getElementById("o")!.textContent = location.origin;
// Demo only: proves a hung app can't stall the shell.
document.getElementById("freeze")!.onclick = () => {
  for (;;);
};
