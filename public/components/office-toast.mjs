import OfficeComponent from "./office-component.mjs";

class OfficeToast extends OfficeComponent {
  static hostAttributes = {"class": "toast", "role": "status", "id": "toast"};
  model = {};

  render() {
    this.appendChildren(this, [

    ]);
  }

  initialize() {

    let timer;
    this.show = (message, error = false) => {
      this.textContent = message;
      this.className = `toast show${error ? ' error' : ''}`;
      clearTimeout(timer);
      timer = setTimeout(() => { this.className = 'toast'; }, 3200);
    };
    this.onDisconnect = () => clearTimeout(timer);
  }
}

customElements.define("office-toast", OfficeToast);
export default OfficeToast;
