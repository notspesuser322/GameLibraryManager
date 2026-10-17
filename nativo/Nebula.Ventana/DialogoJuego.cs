using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>
    /// La ficha de un juego, en una ventana propia: carátula, datos, notas y los
    /// botones de siempre (jugar, detener, abrir la carpeta, guardar).
    ///
    /// Todo son controles de Windows. Los datos largos (una ruta de instalación
    /// eterna, media docena de géneros) van dentro de un panel con barra de
    /// desplazamiento: así nunca se comen los botones, por larga que sea la ficha.
    /// </summary>
    internal sealed class DialogoJuego : Form
    {
        private readonly Api api;
        private readonly Juego juego;
        private readonly List<EstadoJuego> estados;
        private readonly PictureBox caratula;
        private readonly ComboBox estado;
        private readonly TextBox notas;
        private readonly Button jugar;
        private readonly Label marcha;
        private readonly Timer reloj;

        public bool Cambio { get; private set; }

        public DialogoJuego(Api api, Juego juego, List<EstadoJuego> estados)
        {
            this.api = api;
            this.juego = juego;
            this.estados = estados ?? new List<EstadoJuego>();
            Tema.Aplicar(this);

            Text = juego.Nombre + " — Nébula";
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(780, 620);
            BackColor = Tema.Fondo;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            /* ------------------------------------------------- columna izquierda */

            caratula = new PictureBox();
            caratula.Location = new Point(24, 24);
            caratula.Size = new Size(200, 290);
            caratula.SizeMode = PictureBoxSizeMode.Zoom;
            caratula.BackColor = Tema.Panel;

            Label etiquetaEstado = Tema.Etiqueta("Estado", Tema.Pequena, Tema.Suave);
            etiquetaEstado.Location = new Point(24, 330);

            estado = new ComboBox();
            estado.DropDownStyle = ComboBoxStyle.DropDownList;
            estado.Width = 200;
            estado.Height = 26;
            estado.Location = new Point(24, 350);
            estado.BackColor = Tema.PanelClaro;
            estado.ForeColor = Tema.Texto;
            estado.FlatStyle = FlatStyle.Flat;
            estado.Font = Tema.Normal;
            foreach (EstadoJuego posible in estados) estado.Items.Add(posible.Etiqueta);
            int indice = 0;
            for (int i = 0; i < estados.Count; i++)
            {
                if (estados[i].Id == juego.Estado) indice = i;
            }
            if (estado.Items.Count > 0) estado.SelectedIndex = indice;

            Label etiquetaNotas = Tema.Etiqueta("Notas", Tema.Pequena, Tema.Suave);
            etiquetaNotas.Location = new Point(24, 392);

            notas = new TextBox();
            notas.Multiline = true;
            notas.ScrollBars = ScrollBars.Vertical;
            notas.Width = 340;
            notas.Height = 120;
            notas.Location = new Point(24, 412);
            notas.BackColor = Tema.PanelClaro;
            notas.ForeColor = Tema.Texto;
            notas.BorderStyle = BorderStyle.FixedSingle;
            notas.Font = Tema.Normal;
            notas.Text = juego.Notas;

            /* --------------------------------------------------- columna derecha */

            /* una línea, con puntos suspensivos: un nombre larguísimo no empuja nada */
            Label titulo = Tema.Etiqueta(juego.Nombre, Tema.Subtitulo);
            titulo.Location = new Point(384, 24);
            titulo.AutoSize = false;
            titulo.Size = new Size(372, 40);
            titulo.AutoEllipsis = true;

            Label plataforma = Tema.Etiqueta(juego.PlataformaEtiqueta + " · " + juego.EstadoEtiqueta, Tema.Pequena,
                Tema.DeHex(juego.PlataformaColor, Tema.Suave));
            plataforma.Location = new Point(384, 74);

            /* los datos van en un panel con scroll: una ruta larga no empuja nada */
            Panel ficha = new Panel();
            ficha.Location = new Point(384, 100);
            ficha.Size = new Size(372, 200);
            ficha.BackColor = Tema.Panel;
            ficha.AutoScroll = true;

            Label datos = Tema.Etiqueta(
                "Horas jugadas: " + juego.Horas + "\n" +
                "Sesiones: " + juego.Sesiones + "\n" +
                "Última vez: " + Tema.Fecha(juego.UltimaVez) + "\n" +
                "Lanzamiento: " + (juego.Lanzamiento.Length > 0 ? juego.Lanzamiento : "—") + "\n" +
                "Desarrolladores: " + juego.Desarrolladores + "\n" +
                "Géneros: " + juego.GenerosTexto + "\n" +
                "Tamaño: " + Tema.Peso(juego.PesoBytes) + "\n" +
                "Carpeta: " + (juego.Carpeta.Length > 0 ? juego.Carpeta : "—"), Tema.Pequena, Tema.Texto);
            datos.Location = new Point(12, 10);
            datos.MaximumSize = new Size(330, 0);
            ficha.Controls.Add(datos);

            marcha = Tema.Etiqueta(juego.EnMarcha ? "● En marcha" : string.Empty, Tema.Negrita, Tema.Verde);
            marcha.Location = new Point(384, 306);

            jugar = Tema.Boton(juego.EnMarcha ? "Detener el juego" : "Jugar", true, 160);
            jugar.Location = new Point(384, 330);
            jugar.Click += async (s, e) => await AlternarJuego();

            Button carpeta = Tema.Boton("Abrir la carpeta", false, 170);
            carpeta.Location = new Point(556, 330);
            carpeta.Click += async (s, e) =>
            {
                try
                {
                    await api.AbrirCarpetaAsync(juego.Id);
                }
                catch (Exception error)
                {
                    MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            };

            Label etiquetaDescripcion = Tema.Etiqueta("Descripción", Tema.Pequena, Tema.Suave);
            etiquetaDescripcion.Location = new Point(384, 382);

            TextBox descripcion = new TextBox();
            descripcion.Multiline = true;
            descripcion.ReadOnly = true;
            descripcion.ScrollBars = ScrollBars.Vertical;
            descripcion.Width = 372;
            descripcion.Height = 120;
            descripcion.Location = new Point(384, 402);
            descripcion.BackColor = Tema.Panel;
            descripcion.ForeColor = Tema.Suave;
            descripcion.BorderStyle = BorderStyle.FixedSingle;
            descripcion.Font = Tema.Pequena;
            descripcion.Text = juego.Descripcion.Length > 0 ? juego.Descripcion : "Sin descripción todavía.";

            /* ------------------------------------------------------------ abajo */

            Button guardar = Tema.Boton("Guardar cambios", true, 160);
            guardar.Location = new Point(500, 566);
            guardar.Click += async (s, e) => await Guardar();

            Button cerrar = Tema.Boton("Cerrar", false, 92);
            cerrar.Location = new Point(664, 566);
            cerrar.Click += (s, e) => Close();

            Controls.Add(caratula);
            Controls.Add(etiquetaEstado);
            Controls.Add(estado);
            Controls.Add(etiquetaNotas);
            Controls.Add(notas);
            Controls.Add(titulo);
            Controls.Add(plataforma);
            Controls.Add(ficha);
            Controls.Add(marcha);
            Controls.Add(jugar);
            Controls.Add(carpeta);
            Controls.Add(etiquetaDescripcion);
            Controls.Add(descripcion);
            Controls.Add(guardar);
            Controls.Add(cerrar);
            AcceptButton = guardar;
            CancelButton = cerrar;

            reloj = new Timer();
            reloj.Interval = 3000;
            reloj.Tick += async (s, e) => await RefrescarEstado();
            reloj.Start();

            CargarCaratula();
        }

        private async void CargarCaratula()
        {
            try
            {
                Image imagen = await api.PortadaAsync(juego.Id);
                if (IsDisposed || imagen == null) return;
                caratula.Image = imagen;
            }
            catch { /* sin carátula se queda el hueco */ }
        }

        private async Task AlternarJuego()
        {
            jugar.Enabled = false;
            try
            {
                if (juego.EnMarcha) await api.DetenerAsync(juego.Id);
                else await api.LanzarAsync(juego.Id);
                juego.EnMarcha = !juego.EnMarcha;
                marcha.Text = juego.EnMarcha ? "● En marcha" : string.Empty;
                jugar.Text = juego.EnMarcha ? "Detener el juego" : "Jugar";
                Cambio = true;
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                jugar.Enabled = true;
            }
        }

        private async Task RefrescarEstado()
        {
            try
            {
                JToken launcher = await api.LauncherAsync();
                JToken sesiones = launcher == null ? null : launcher["sessions"];
                bool marchaAhora = sesiones != null && sesiones[juego.Id] != null;
                if (marchaAhora != juego.EnMarcha)
                {
                    juego.EnMarcha = marchaAhora;
                    marcha.Text = marchaAhora ? "● En marcha" : string.Empty;
                    jugar.Text = marchaAhora ? "Detener el juego" : "Jugar";
                    Cambio = true;
                }
            }
            catch { /* el motor está ocupado; se reintenta en el siguiente ciclo */ }
        }

        private async Task Guardar()
        {
            JObject cambios = new JObject();
            if (estado.SelectedIndex >= 0)
            {
                /* se manda el identificador, no la etiqueta */
                cambios["status"] = IdDeEstado(estado.SelectedIndex);
            }
            cambios["notes"] = notas.Text;
            try
            {
                await api.ActualizarJuegoAsync(juego.Id, cambios);
                juego.Notas = notas.Text;
                juego.EstadoEtiqueta = estado.Text;
                Cambio = true;
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private string IdDeEstado(int indice)
        {
            /* el desplegable sigue el mismo orden que la lista de estados del motor */
            if (indice >= 0 && indice < estados.Count) return estados[indice].Id;
            return "backlog";
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            reloj.Stop();
            base.OnFormClosed(e);
        }
    }
}
