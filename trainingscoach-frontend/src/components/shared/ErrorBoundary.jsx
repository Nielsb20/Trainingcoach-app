import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Vangt een renderfout op, zodat er iets blijft staan.
 *
 * Zonder dit maakt één fout in een willekeurig tabblad het hele scherm wit:
 * React haalt bij een onopgevangen fout de complete boom weg. Dat is altijd
 * vervelend, maar midden in een training betekent het dat je logscherm
 * verdwijnt en je niet meer kunt vastleggen wat je net getild hebt.
 *
 * `AutomationPanel` had deze les lokaal al geleerd ("een kapot instellingen-
 * paneel mag de rest van de pagina niet verbergen"); dit is hetzelfde principe
 * voor de hele app.
 *
 * Bewust een klassecomponent: hooks kunnen dit niet. Er is geen React-API om
 * een renderfout met een functiecomponent op te vangen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // In de console, want daar kijk je als je uitzoekt wat er misging. De
    // melding op het scherm blijft leesbaar voor wie alleen wil doortrainen.
    console.error("Onverwachte fout in de interface:", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Naar een ander tabblad gaan is een nieuwe kans: de fout zat waarschijnlijk
    // in het scherm dat je net verliet.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="tc-card" style={{ borderColor: "#B85C5C" }}>
        <div className="tc-card-head">
          <span className="tc-ex-name">
            <AlertTriangle size={15} style={{ marginRight: 6, verticalAlign: "middle", color: "#D08585" }} />
            Dit scherm liep vast
          </span>
        </div>
        <p className="tc-import-help">
          Er ging iets mis bij het tekenen van dit tabblad. De rest van de app werkt nog: kies een
          ander tabblad, of laad de pagina opnieuw. Je gegevens staan op de server en zijn niet
          geraakt — er is hier niets verloren gegaan.
        </p>
        <p className="tc-history-detail">{String(this.state.error?.message || this.state.error)}</p>
        <div className="tc-actionbar">
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={13} /> Opnieuw proberen
          </button>
          <button className="tc-btn tc-btn-ghost tc-btn-sm" onClick={() => window.location.reload()}>
            Pagina herladen
          </button>
        </div>
      </div>
    );
  }
}
