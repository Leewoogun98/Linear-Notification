declare const notiApi: {
  onContent: (cb: (d: { title: string; body: string }) => void) => void;
  dismiss: () => void;
};

notiApi.onContent((d) => {
  document.getElementById("title")!.textContent = d.title;
  document.getElementById("body")!.textContent = d.body;
});
document.getElementById("card")!.addEventListener("click", () => notiApi.dismiss());
