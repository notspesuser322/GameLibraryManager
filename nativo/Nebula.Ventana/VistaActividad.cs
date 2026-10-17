using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>Actividad reciente: los últimos juegos que se abrieron y sus horas.</summary>
    internal sealed class VistaActividad : UserControl
    {
        private readonly Api api;
        private readonly ListView lista;
        private readonly Label resumen;
        private readonly Label enMarcha;

        public event Action<string> Aviso;

        public VistaActividad(Api api)
        {
            this.api = api;
            Tema.Aplicar(this);
            Dock = DockStyle.Fill;

            PanelRedondeado bloque = new PanelRedondeado();
            bloque.Dock = DockStyle.Fill;
            bloque.Padding = new Padding(16);

            resumen = Tema.Etiqueta("Actividad reciente", Tema.Subtitulo);
            resumen.Location = new Point(16, 14);

            enMarcha = Tema.Etiqueta(string.Empty, Tema.Negrita, Tema.Verde);
            enMarcha.Location = new Point(240, 20);

            lista = new ListView();
            lista.View = View.Details;
            lista.FullRowSelect = true;
            lista.Columns.Add("Juego", 340);
            lista.Columns.Add("Última vez", 150);
            lista.Columns.Add("Tiempo jugado", 130);
            lista.Location = new Point(16, 52);
            lista.Size = new Size(660, 380);
            lista.BackColor = Tema.PanelClaro;
            lista.ForeColor = Tema.Texto;
            lista.BorderStyle = BorderStyle.FixedSingle;
            lista.Font = Tema.Pequena;

            bloque.Controls.Add(resumen);
            bloque.Controls.Add(enMarcha);
            bloque.Controls.Add(lista);
            Controls.Add(bloque);

            /* la lista acompaña el ancho de la ventana (y se estira a lo alto) */
            bloque.Resize += (s, e) =>
            {
                lista.Width = Math.Max(300, bloque.ClientSize.Width - 32);
                lista.Height = Math.Max(160, bloque.ClientSize.Height - 72);
            };
        }

        public async Task RecargarAsync()
        {
            JToken estado;
            try
            {
                estado = await api.EstadoAsync();
            }
            catch (Exception error)
            {
                Avisar("No se pudo leer la actividad: " + error.Message);
                return;
            }
            if (estado == null) return;
            lista.BeginUpdate();
            lista.Items.Clear();
            JToken stats = estado["stats"];
            JArray recientes = stats == null ? null : stats["recent"] as JArray;
            int contador = 0;
            if (recientes != null)
            {
                foreach (JToken token in recientes)
                {
                    ListViewItem fila = new ListViewItem(Juego.Texto(token, "name"));
                    fila.SubItems.Add(Tema.Fecha(Juego.Texto(token, "lastPlayed")));
                    fila.SubItems.Add(Tema.Duracion(Juego.Numero(token, "seconds")));
                    lista.Items.Add(fila);
                    contador++;
                }
            }
            lista.EndUpdate();
            resumen.Text = contador == 0 ? "Todavía no hay actividad" : "Actividad reciente";

            int activos = 0;
            JToken launcher = estado["launcher"];
            JToken sesiones = launcher == null ? null : launcher["sessions"];
            if (sesiones is JObject) activos = ((JObject)sesiones).Count;
            enMarcha.Text = activos > 0 ? activos + (activos == 1 ? " juego en marcha" : " juegos en marcha") : string.Empty;
        }

        private void Avisar(string texto)
        {
            if (Aviso != null) Aviso(texto);
        }
    }
}
