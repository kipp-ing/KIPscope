/**
 * Whether a star request is done when its POST answers (add-favourites F10): only when the answer's
 * list equals the shown one element for element, i.e. the POST changed nothing visible and no live
 * `favourites` push will follow. Otherwise the push is still to come and must find the request.
 */
export function shouldClearOnAnswer(
  answerNames: readonly string[],
  shownNames: readonly string[],
): boolean {
  return (
    answerNames.length === shownNames.length && answerNames.every((n, i) => n === shownNames[i])
  );
}
