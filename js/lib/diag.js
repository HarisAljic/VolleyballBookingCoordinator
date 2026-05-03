export function isVbDiag() {
  try {
    return (
      new URLSearchParams(window.location.search).has("vbdiag") ||
      window.localStorage.getItem("vbdiag") === "1"
    );
  } catch {
    return false;
  }
}
