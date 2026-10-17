using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>
    /// Ajustes: lo que de verdad se toca a mano (análisis y fichas automáticas,
    /// dónde están los datos y el registro) y los créditos.
    /// </summary>
    internal sealed class VistaAjustes : UserControl
    {
        private readonly Api api;
        private readonly CheckBox analisisAutomatico;
        private readonly CheckBox fichasAlAgregar;
        private readonly CheckBox fichasAlEscanear;
        private readonly CheckBox descargarCaratulas;
        private readonly CheckBox medirTiempo;
        private readonly Label datos;
        private readonly Label registro;
        private readonly Label version;
        private bool cargando;

        public event Action<string> Aviso;

        public VistaAjustes(Api api)
        {
            this.api = api;
            Tema.Aplicar(this);
            Dock = DockStyle.Fill;

            /* columna que se desplaza si la ventana es bajita: nada queda cortado */
            AutoScroll = true;

            PanelRedondeado bloque = new PanelRedondeado();
            bloque.Location = new Point(0, 0);
            bloque.Size = new Size(720, 320);
            bloque.Padding = new Padding(16);

            Label titulo = Tema.Etiqueta("Cómo se porta Nébula", Tema.Subtitulo);
            titulo.Location = new Point(16, 12);

            analisisAutomatico = Casilla(bloque, 16, 44, "Analizar mis carpetas al abrir el programa",
                "Las carpetas guardadas se revisan solas en cada arranque.");
            fichasAlAgregar = Casilla(bloque, 16, 82, "Buscar ficha y carátula al agregar un juego",
                "Da igual si lo agregas a mano o en un análisis.");
            fichasAlEscanear = Casilla(bloque, 16, 120, "Buscar ficha y carátula al analizar carpetas",
                "Se completa lo que falte; no pisa lo que ya escribiste.");
            descargarCaratulas = Casilla(bloque, 16, 158, "Descargar carátulas de internet",
                "Si se apaga, se usa la carátula generada con el nombre.");
            medirTiempo = Casilla(bloque, 16, 196, "Medir el tiempo que juego",
                "Se cuenta mientras el juego está abierto.");

            Label etiquetaDatos = Tema.Etiqueta("Datos y registro", Tema.Subtitulo);
            etiquetaDatos.Location = new Point(16, 240);
            datos = Tema.Etiqueta("—", Tema.Pequena, Tema.Suave);
            datos.Location = new Point(16, 266);
            registro = Tema.Etiqueta("—", Tema.Pequena, Tema.Suave);
            registro.Location = new Point(16, 285);
            version = Tema.Etiqueta(string.Empty, Tema.Pequena, Tema.Suave);
            version.Location = new Point(16, 304);

            bloque.Controls.Add(titulo);
            bloque.Controls.Add(etiquetaDatos);
            bloque.Controls.Add(datos);
            bloque.Controls.Add(registro);
            bloque.Controls.Add(version);

            PanelRedondeado acciones = new PanelRedondeado();
            acciones.Location = new Point(0, 332);
            acciones.Size = new Size(720, 116);
            acciones.Padding = new Padding(16);

            /* un panel que fluye: si la ventana es estrecha, los botones bajan solos */
            FlowLayoutPanel filaAcciones = new FlowLayoutPanel();
            filaAcciones.Dock = DockStyle.Fill;
            filaAcciones.FlowDirection = FlowDirection.LeftToRight;
            filaAcciones.WrapContents = true;
            filaAcciones.AutoScroll = false;
            filaAcciones.Padding = new Padding(0);

            Button abrirDatos = Tema.Boton("Abrir la carpeta de datos", false, 210);
            abrirDatos.Margin = new Padding(0, 0, 8, 8);
            abrirDatos.Click += (s, e) => AbrirConExplorador(RutaDeDatos());

            Button abrirRegistro = Tema.Boton("Ver el registro (Nebula.log)", false, 220);
            abrirRegistro.Margin = new Padding(0, 0, 8, 8);
            abrirRegistro.Click += (s, e) => AbrirConExplorador(RutaDeRegistro());

            Button demo = Tema.Boton("Cargar juegos de ejemplo", false, 210);
            demo.Margin = new Padding(0, 0, 8, 8);
            demo.Click += async (s, e) => await Demo(true);

            Button quitarDemo = Tema.Boton("Quitar los ejemplos", false, 180);
            quitarDemo.Margin = new Padding(0, 0, 8, 8);
            quitarDemo.Click += async (s, e) => await Demo(false);

            filaAcciones.Controls.Add(abrirDatos);
            filaAcciones.Controls.Add(abrirRegistro);
            filaAcciones.Controls.Add(demo);
            filaAcciones.Controls.Add(quitarDemo);
            acciones.Controls.Add(filaAcciones);

            PanelRedondeado creditos = new PanelRedondeado();
            creditos.Location = new Point(0, 460);
            creditos.Size = new Size(720, 140);
            creditos.Padding = new Padding(16);

            Label tituloCreditos = Tema.Etiqueta("De dónde viene la idea", Tema.Subtitulo);
            tituloCreditos.Location = new Point(16, 12);
            Label textoCreditos = Tema.Etiqueta(
                "Nébula sigue la idea de Playnite, el gestor de biblioteca libre para Windows: una sola " +
                "lista con todos tus juegos, su ficha, su carátula y sus horas. Nébula es una versión " +
                "propia, en español. El mérito de la idea original es de sus autores.",
                Tema.Pequena);
            textoCreditos.Location = new Point(16, 40);
            textoCreditos.MaximumSize = new Size(640, 0);

            LinkLabel enlace = new LinkLabel();
            enlace.Text = "playnite.link";
            enlace.Location = new Point(16, 108);
            enlace.AutoSize = true;
            enlace.LinkColor = Tema.Acento;
            enlace.ActiveLinkColor = Color.White;
            enlace.Font = Tema.Pequena;
            enlace.LinkBehavior = LinkBehavior.HoverUnderline;
            enlace.LinkClicked += (s, e) => AbrirConExplorador("https://playnite.link");
            creditos.Controls.Add(tituloCreditos);
            creditos.Controls.Add(textoCreditos);
            creditos.Controls.Add(enlace);

            Controls.Add(bloque);
            Controls.Add(acciones);
            Controls.Add(creditos);

            Resize += (s, e) => AjustarAnchos(bloque, acciones, creditos, filaAcciones, textoCreditos);
            AjustarAnchos(bloque, acciones, creditos, filaAcciones, textoCreditos);
        }

        /// <summary>Las tarjetas ocupan el ancho disponible y los botones se reparten solos.</summary>
        private void AjustarAnchos(Control bloque, Control acciones, Control creditos, Control filaAcciones, Label textoCreditos)
        {
            int ancho = Math.Max(560, ClientSize.Width - 24);
            bloque.Width = ancho;
            acciones.Width = ancho;
            creditos.Width = ancho;
            filaAcciones.Width = Math.Max(300, acciones.ClientSize.Width - 32);
            textoCreditos.MaximumSize = new Size(Math.Max(300, ancho - 40), 0);
        }

        private static CheckBox Casilla(Control padre, int x, int y, string texto, string nota)
        {
            CheckBox casilla = new CheckBox();
            casilla.Text = texto;
            casilla.AutoSize = true;
            casilla.Location = new Point(x, y);
            casilla.ForeColor = Tema.Texto;
            casilla.Font = Tema.Negrita;
            casilla.BackColor = Color.Transparent;
            Label detalle = Tema.Etiqueta(nota, Tema.Pequena, Tema.Suave);
            detalle.Location = new Point(x + 22, y + 20);
            padre.Controls.Add(casilla);
            padre.Controls.Add(detalle);
            return casilla;
        }

        private async void CasillaCambiada(object remitente, EventArgs e)
        {
            if (cargando) return;
            JObject cambios = new JObject();
            cambios["autoScanOnStart"] = analisisAutomatico.Checked;
            cambios["fetchRemoteArt"] = descargarCaratulas.Checked;
            cambios["trackPlaytime"] = medirTiempo.Checked;
            JObject metadatos = new JObject();
            metadatos["autoFillOnAdd"] = fichasAlAgregar.Checked;
            metadatos["autoFillOnScan"] = fichasAlEscanear.Checked;
            cambios["metadata"] = metadatos;
            try
            {
                await api.GuardarAjustesAsync(cambios);
                Avisar("Ajustes guardados");
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        public async Task RecargarAsync()
        {
            try
            {
                JToken estado = await api.EstadoAsync();
                if (estado == null) return;
                JToken ajustes = estado["settings"];
                cargando = true;
                analisisAutomatico.Checked = Juego.Booleano(ajustes, "autoScanOnStart", true);
                descargarCaratulas.Checked = Juego.Booleano(ajustes, "fetchRemoteArt", true);
                medirTiempo.Checked = Juego.Booleano(ajustes, "trackPlaytime", true);
                JToken metadatos = ajustes == null ? null : ajustes["metadata"];
                fichasAlAgregar.Checked = Juego.Booleano(metadatos, "autoFillOnAdd", true);
                fichasAlEscanear.Checked = Juego.Booleano(metadatos, "autoFillOnScan", true);
                cargando = false;

                /* las casillas se enganchan después de rellenarlas: así no guardan nada al pintar */
                if (analisisAutomatico.Tag == null)
                {
                    analisisAutomatico.CheckedChanged += CasillaCambiada;
                    fichasAlAgregar.CheckedChanged += CasillaCambiada;
                    fichasAlEscanear.CheckedChanged += CasillaCambiada;
                    descargarCaratulas.CheckedChanged += CasillaCambiada;
                    medirTiempo.CheckedChanged += CasillaCambiada;
                    analisisAutomatico.Tag = "listo";
                }

                JToken app = estado["app"];
                datos.Text = "Datos: " + Juego.Texto(app, "dataDir");
                registro.Text = "Registro: " + Juego.Texto(app, "log", "Nebula.log");
                version.Text = "Nébula " + Juego.Texto(app, "version") + " · ventana nativa (C#) · motor: " +
                               Juego.Texto(app, "platform");
            }
            catch (Exception error)
            {
                Avisar("No se pudieron leer los ajustes: " + error.Message);
            }
        }

        private string RutaDeDatos()
        {
            int dosPuntos = datos.Text.IndexOf(':');
            return dosPuntos > 0 ? datos.Text.Substring(dosPuntos + 1).Trim() : string.Empty;
        }

        private string RutaDeRegistro()
        {
            int dosPuntos = registro.Text.IndexOf(':');
            return dosPuntos > 0 ? registro.Text.Substring(dosPuntos + 1).Trim() : string.Empty;
        }

        private async Task Demo(bool cargar)
        {
            try
            {
                if (cargar) await api.CargarDemoAsync();
                else await api.QuitarDemoAsync();
                Avisar(cargar ? "Juegos de ejemplo cargados" : "Ejemplos quitados");
                await RecargarAsync();
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void AbrirConExplorador(string ruta)
        {
            if (string.IsNullOrEmpty(ruta)) return;
            try
            {
                Process.Start(new ProcessStartInfo(ruta) { UseShellExecute = true });
            }
            catch (Exception error)
            {
                MessageBox.Show(this, "No se pudo abrir: " + error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void Avisar(string texto)
        {
            if (Aviso != null) Aviso(texto);
        }
    }
}
