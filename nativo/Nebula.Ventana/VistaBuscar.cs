using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>
    /// «Buscar juegos»: las carpetas que Nébula vigila y el alta de juegos nuevos.
    ///
    /// Todo con cuadros de diálogo de Windows: se elige la carpeta con el
    /// explorador de siempre, se analiza, se marcan los juegos encontrados y se
    /// agregan. La carpeta queda guardada y se revisa sola en cada arranque.
    /// </summary>
    internal sealed class VistaBuscar : UserControl
    {
        private readonly Api api;
        private readonly ListView carpetas;
        private readonly CheckedListBox hallazgos;
        private readonly Label resumen;
        private readonly Button agregarHallazgos;
        private readonly Label estado;
        private List<JToken> encontrados = new List<JToken>();
        private List<CarpetaVigilada> guardadas = new List<CarpetaVigilada>();
        private string ultimaCarpeta = string.Empty;

        public event Action<string> Aviso;

        public VistaBuscar(Api api)
        {
            this.api = api;
            Tema.Aplicar(this);
            Dock = DockStyle.Fill;

            /* la vista se desplaza si la ventana es bajita: nunca se corta un botón */
            AutoScroll = true;

            PanelRedondeado bloqueCarpetas = new PanelRedondeado();
            bloqueCarpetas.Location = new Point(0, 0);
            bloqueCarpetas.Size = new Size(720, 236);
            bloqueCarpetas.Padding = new Padding(16);

            Label titulo = Tema.Etiqueta("Carpetas vigiladas", Tema.Subtitulo);
            titulo.Location = new Point(16, 12);

            Label nota = Tema.Etiqueta(
                "Nébula revisa estas carpetas sola en cada arranque y suma los juegos que aparezcan. " +
                "También busca la ficha y la carátula de cada juego nuevo.", Tema.Pequena, Tema.Suave);
            nota.Location = new Point(16, 40);
            nota.MaximumSize = new Size(760, 0);

            carpetas = new ListView();
            carpetas.View = View.Details;
            carpetas.FullRowSelect = true;
            carpetas.MultiSelect = false;
            carpetas.Columns.Add("Carpeta", 430);
            carpetas.Columns.Add("Tipo", 120);
            carpetas.Columns.Add("Subcarpetas", 100);
            carpetas.Location = new Point(16, 92);
            carpetas.Width = 688;
            carpetas.Height = 84;
            carpetas.BackColor = Tema.PanelClaro;
            carpetas.ForeColor = Tema.Texto;
            carpetas.BorderStyle = BorderStyle.FixedSingle;
            carpetas.Font = Tema.Pequena;

            Button agregar = Tema.Boton("Agregar una carpeta y buscar juegos…", true, 290);
            agregar.Location = new Point(16, 184);
            agregar.Click += async (s, e) => await AgregarCarpeta();

            Button analizar = Tema.Boton("Analizar todas las carpetas", false, 220);
            analizar.Location = new Point(316, 184);
            analizar.Click += async (s, e) => await AnalizarTodo();

            Button quitar = Tema.Boton("Quitar la carpeta", false, 150);
            quitar.Location = new Point(546, 184);
            quitar.Click += async (s, e) => await QuitarCarpeta();

            bloqueCarpetas.Controls.Add(titulo);
            bloqueCarpetas.Controls.Add(nota);
            bloqueCarpetas.Controls.Add(carpetas);
            bloqueCarpetas.Controls.Add(agregar);
            bloqueCarpetas.Controls.Add(analizar);
            bloqueCarpetas.Controls.Add(quitar);

            PanelRedondeado bloqueResultados = new PanelRedondeado();
            bloqueResultados.Location = new Point(0, 248);
            bloqueResultados.Size = new Size(720, 320);
            bloqueResultados.Padding = new Padding(16);

            resumen = Tema.Etiqueta("Elige una carpeta para empezar.", Tema.Negrita);
            resumen.Location = new Point(16, 10);

            hallazgos = new CheckedListBox();
            hallazgos.Location = new Point(16, 36);
            hallazgos.Size = new Size(688, 210);
            hallazgos.BackColor = Tema.PanelClaro;
            hallazgos.ForeColor = Tema.Texto;
            hallazgos.BorderStyle = BorderStyle.FixedSingle;
            hallazgos.Font = Tema.Pequena;
            hallazgos.CheckOnClick = true;

            agregarHallazgos = Tema.Boton("Agregar los juegos marcados", true, 240);
            agregarHallazgos.Location = new Point(16, 256);
            agregarHallazgos.Enabled = false;
            agregarHallazgos.Click += async (s, e) => await Importar();

            estado = Tema.Etiqueta(string.Empty, Tema.Pequena, Tema.Suave);
            estado.Location = new Point(270, 264);

            bloqueResultados.Controls.Add(resumen);
            bloqueResultados.Controls.Add(hallazgos);
            bloqueResultados.Controls.Add(agregarHallazgos);
            bloqueResultados.Controls.Add(estado);

            Controls.Add(bloqueCarpetas);
            Controls.Add(bloqueResultados);

            Resize += (s, e) => AjustarAnchos(bloqueCarpetas, bloqueResultados);
            AjustarAnchos(bloqueCarpetas, bloqueResultados);
        }

        /// <summary>Las dos tarjetas ocupan el ancho disponible, siempre con margen.</summary>
        private void AjustarAnchos(Control bloqueCarpetas, Control bloqueResultados)
        {
            int ancho = Math.Max(540, ClientSize.Width - 24);
            bloqueCarpetas.Width = ancho;
            bloqueResultados.Width = ancho;
            carpetas.Width = Math.Max(300, bloqueCarpetas.ClientSize.Width - 32);
            hallazgos.Width = Math.Max(300, bloqueResultados.ClientSize.Width - 32);
        }

        public async Task RecargarAsync()
        {
            try
            {
                JToken raices = await api.RaicesAsync();
                guardadas = CarpetaVigilada.Desde(raices["roots"]);
            }
            catch (Exception error)
            {
                Avisar("No se pudieron leer las carpetas: " + error.Message);
                return;
            }
            carpetas.BeginUpdate();
            carpetas.Items.Clear();
            foreach (CarpetaVigilada carpeta in guardadas)
            {
                ListViewItem fila = new ListViewItem(carpeta.Ruta);
                fila.SubItems.Add(carpeta.TipoTexto);
                fila.SubItems.Add(carpeta.Recursiva ? "sí" : "no");
                fila.Tag = carpeta;
                carpetas.Items.Add(fila);
            }
            carpetas.EndUpdate();
            if (guardadas.Count == 0)
            {
                resumen.Text = "Todavía no hay carpetas. Agrega la carpeta donde guardas tus juegos.";
            }
        }

        /* ------------------------------------------------------------ acciones */

        private async Task AgregarCarpeta()
        {
            using (FolderBrowserDialog dialogo = new FolderBrowserDialog())
            {
                dialogo.Description = "Elige la carpeta donde están tus juegos (o la de un juego concreto)";
                dialogo.ShowNewFolderButton = false;
                if (dialogo.ShowDialog(this) != DialogResult.OK) return;

                string tipo = PreguntarTipo();
                if (tipo == null) return;

                ultimaCarpeta = dialogo.SelectedPath;
                estado.Text = "Analizando «" + ultimaCarpeta + "»…";
                UseWaitCursor = true;
                try
                {
                    /* 1. la carpeta queda guardada... */
                    await api.AgregarRaizAsync(ultimaCarpeta, tipo, true);
                    await RecargarAsync();
                    /* 2. ...y se analiza en el acto */
                    await Analizar(ultimaCarpeta, tipo);
                }
                catch (Exception error)
                {
                    estado.Text = string.Empty;
                    MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                finally
                {
                    UseWaitCursor = false;
                }
            }
        }

        private void CargarResultados(JToken respuesta, string origen)
        {
            encontrados = new List<JToken>();
            hallazgos.Items.Clear();
            if (respuesta == null) return;
            JArray lista = respuesta["findings"] as JArray;
            if (lista == null && respuesta["candidates"] is JArray)
            {
                /* carpeta de un solo juego: se ofrece el ejecutable que eligió el motor */
                lista = new JArray();
                JArray candidatos = (JArray)respuesta["candidates"];
                if (candidatos.Count > 0 && respuesta["name"] != null)
                {
                    JObject unico = new JObject();
                    unico["name"] = respuesta["name"].ToString();
                    unico["executable"] = candidatos[0]["path"] != null ? candidatos[0]["path"].ToString() : null;
                    unico["installDir"] = respuesta["installDir"] != null ? respuesta["installDir"].ToString() : origen;
                    unico["workDir"] = respuesta["installDir"] != null ? respuesta["installDir"].ToString() : origen;
                    unico["coverFile"] = respuesta["coverFile"] != null ? respuesta["coverFile"].ToString() : null;
                    unico["sizeBytes"] = respuesta["sizeBytes"] != null ? respuesta["sizeBytes"].Value<long>() : 0;
                    unico["platform"] = "manual";
                    lista.Add(unico);
                }
            }
            if (lista == null) return;

            foreach (JToken token in lista)
            {
                Juego juego = Juego.Desde(token);
                string detalle = juego.Nombre;
                string ejecutable = Juego.Texto(token, "executable");
                if (ejecutable.Length > 0) detalle += "  —  " + ejecutable;
                else
                {
                    string rom = Juego.Texto(token, "romPath");
                    string consola = Juego.Texto(token, "consoleLabel");
                    if (consola.Length > 0) detalle += "  —  " + consola;
                    if (rom.Length > 0) detalle += "  —  " + rom;
                }
                hallazgos.Items.Add(detalle, true);
                encontrados.Add(token);
            }
            resumen.Text = encontrados.Count == 0
                ? "No se encontraron juegos en esa carpeta. Prueba con otro tipo de carpeta."
                : encontrados.Count + (encontrados.Count == 1 ? " juego encontrado" : " juegos encontrados") + " en " + origen;
            agregarHallazgos.Enabled = encontrados.Count > 0;
        }

        private async Task Analizar(string ruta, string tipo)
        {
            agregarHallazgos.Enabled = false;
            try
            {
                JToken respuesta = await api.AnalizarCarpetaAsync(ruta, tipo, true);
                CargarResultados(respuesta, ruta);
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                estado.Text = string.Empty;
            }
        }

        private async Task Importar()
        {
            if (encontrados.Count == 0) return;
            JArray marcados = new JArray();
            for (int i = 0; i < hallazgos.Items.Count && i < encontrados.Count; i++)
            {
                if (hallazgos.GetItemChecked(i))
                {
                    JObject envoltorio = new JObject();
                    envoltorio["candidate"] = encontrados[i];
                    marcados.Add(envoltorio);
                }
            }
            if (marcados.Count == 0)
            {
                MessageBox.Show(this, "No marcaste ningún juego.", "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            UseWaitCursor = true;
            agregarHallazgos.Enabled = false;
            estado.Text = "Agregando juegos y buscando sus fichas…";
            try
            {
                JToken resultado = await api.ImportarAsync(marcados);
                int agregados = (int)Juego.Numero(resultado, "added");
                estado.Text = agregados + (agregados == 1 ? " juego agregado" : " juegos agregados");
                Avisar(estado.Text);
                encontrados = new List<JToken>();
                hallazgos.Items.Clear();
                resumen.Text = "Listo. Las fichas y carátulas aparecerán solas en la biblioteca.";
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                UseWaitCursor = false;
                agregarHallazgos.Enabled = encontrados.Count > 0;
            }
        }

        private async Task AnalizarTodo()
        {
            UseWaitCursor = true;
            estado.Text = "Revisando todas las carpetas…";
            try
            {
                JToken resultado = await api.EscanearTodoAsync();
                int agregados = (int)Juego.Numero(resultado, "added");
                int actualizados = (int)Juego.Numero(resultado, "updated");
                estado.Text = "Listo: " + agregados + " juegos nuevos, " + actualizados + " ya estaban.";
                Avisar(estado.Text);
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                UseWaitCursor = false;
            }
        }

        private async Task QuitarCarpeta()
        {
            if (carpetas.SelectedItems.Count == 0)
            {
                MessageBox.Show(this, "Elige antes una carpeta de la lista.", "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            CarpetaVigilada carpeta = carpetas.SelectedItems[0].Tag as CarpetaVigilada;
            if (carpeta == null) return;
            try
            {
                await api.QuitarRaizAsync(carpeta.Id);
                await RecargarAsync();
                estado.Text = "Carpeta quitada. Los juegos que ya estaban siguen en la biblioteca.";
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        /// <summary>Pregunta qué hay en la carpeta (para analizarla bien).</summary>
        private string PreguntarTipo()
        {
            using (DialogoTipoCarpeta dialogo = new DialogoTipoCarpeta())
            {
                return dialogo.ShowDialog(this) == DialogResult.OK ? dialogo.Tipo : null;
            }
        }

        private void Avisar(string texto)
        {
            if (Aviso != null) Aviso(texto);
        }
    }

    /// <summary>Cuadro pequeño para elegir qué contiene la carpeta.</summary>
    internal sealed class DialogoTipoCarpeta : Form
    {
        private readonly RadioButton varios;
        private readonly RadioButton uno;
        private readonly RadioButton roms;

        public string Tipo { get; private set; }

        public DialogoTipoCarpeta()
        {
            Tema.Aplicar(this);
            Text = "¿Qué hay en la carpeta?";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(480, 250);

            varios = new RadioButton();
            varios.Text = "Varios juegos (una subcarpeta por juego)";
            varios.Location = new Point(20, 20);
            varios.AutoSize = true;
            varios.Checked = true;
            varios.ForeColor = Tema.Texto;

            uno = new RadioButton();
            uno.Text = "Un solo juego";
            uno.Location = new Point(20, 52);
            uno.AutoSize = true;
            uno.ForeColor = Tema.Texto;

            roms = new RadioButton();
            roms.Text = "ROMs de consola";
            roms.Location = new Point(20, 84);
            roms.AutoSize = true;
            roms.ForeColor = Tema.Texto;

            Label nota = Tema.Etiqueta("Se puede cambiar después desde «Buscar juegos».", Tema.Pequena, Tema.Suave);
            nota.Location = new Point(20, 120);

            Button aceptar = Tema.Boton("Analizar", true, 120);
            aceptar.Location = new Point(230, 190);
            aceptar.Click += (s, e) =>
            {
                Tipo = varios.Checked ? "collection" : (uno.Checked ? "single" : "rom");
                DialogResult = DialogResult.OK;
                Close();
            };

            Button cancelar = Tema.Boton("Cancelar", false, 100);
            cancelar.Location = new Point(360, 190);
            cancelar.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };

            Controls.Add(varios);
            Controls.Add(uno);
            Controls.Add(roms);
            Controls.Add(nota);
            Controls.Add(aceptar);
            Controls.Add(cancelar);
            AcceptButton = aceptar;
            CancelButton = cancelar;
        }
    }
}
