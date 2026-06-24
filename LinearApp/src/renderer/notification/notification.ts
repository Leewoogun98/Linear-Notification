declare const notiApi: {
  onContent: (cb: (d: { heading?: string; title: string; body: string; accent?: string }) => void) => void;
  dismiss: () => void;
};

notiApi.onContent((d) => {
  document.getElementById("heading")!.textContent = d.heading ?? "";
  document.getElementById("title")!.textContent = d.title;
  document.getElementById("body")!.textContent = d.body;
  if (d.accent) document.documentElement.style.setProperty("--accent", d.accent);
});
document.getElementById("card")!.addEventListener("click", () => notiApi.dismiss());
