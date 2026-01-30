
class SpeechService {
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private announcementVoice: SpeechSynthesisVoice | null = null;
  private alertVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    this.synth = window.speechSynthesis;
    this.loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = this.loadVoices;
    }
  }

  private loadVoices = () => {
    this.voices = this.synth.getVoices();
    if (this.voices.length > 0) {
      // Attempt to find distinct voices for Spanish
      const esVoices = this.voices.filter(v => v.lang.startsWith('es'));
      
      this.announcementVoice = esVoices.find(v => v.name.includes('Jorge') || v.name.includes('Google español')) || esVoices[0] || this.voices[0];
      this.alertVoice = esVoices.find(v => v.name.includes('Monica') || v.name.includes('Paulina')) || (esVoices.length > 1 ? esVoices[1] : null) || this.voices[1] || this.announcementVoice;

    }
  };

  public speak(text: string, type: 'announcement' | 'alert') {
    if (!this.synth || this.synth.speaking) {
      // Don't interrupt if already speaking
      return;
    }
    if (text !== '') {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => {};
      utterance.onerror = (event) => {
        console.error('SpeechSynthesisUtterance.onerror', event);
      };

      if (type === 'announcement' && this.announcementVoice) {
        utterance.voice = this.announcementVoice;
        utterance.pitch = 1;
        utterance.rate = 1.1;
      } else if (type === 'alert' && this.alertVoice) {
        utterance.voice = this.alertVoice;
        utterance.pitch = 1.2;
        utterance.rate = 1;
      }
      
      utterance.lang = 'es-MX';
      this.synth.speak(utterance);
    }
  }
}

export const speechService = new SpeechService();
