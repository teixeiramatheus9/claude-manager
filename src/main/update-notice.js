// The install relaunches the app, so the phrase has to survive the restart:
// the old version leaves a note and the new one reads it out loud.
export const UPDATE_DONE_PHRASE = 'Pronto, terminei de atualizar! Já tô na versão nova.';

export function shouldAnnounce(mark, currentVersion) {
  if (!mark?.version || !currentVersion) return false;
  return mark.version === currentVersion;
}
