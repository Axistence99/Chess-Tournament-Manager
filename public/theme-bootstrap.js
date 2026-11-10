/** Apply the saved theme before the application renders to avoid a flash. */
(() => {
  const savedTheme = localStorage.getItem("castling.theme.v1");
  const themes = ["dark", "light", "criterion", "ggcc", "ceit"];
  const theme = themes.includes(savedTheme) ? savedTheme : "criterion";
  document.documentElement.dataset.theme = theme;

  const colors = {
    light: "#f3f6f4",
    criterion: "#1c503a",
    ggcc: "#080b10",
    ceit: "#090604",
    dark: "#0b1210",
  };
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", colors[theme]);

  if (theme === "ggcc") {
    document
      .querySelector('link[rel="icon"]')
      ?.setAttribute("href", "./ggcc-logo.png");
    document
      .querySelector('link[rel="apple-touch-icon"]')
      ?.setAttribute("href", "./ggcc-logo.png");
  }
})();
