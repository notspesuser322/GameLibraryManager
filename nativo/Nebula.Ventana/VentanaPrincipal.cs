using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>
    /// La ventana del programa: barra lateral, cabecera y una vista en el centro.
    ///
    /// Todo está dibujado con controles de Windows (WinForms): no hay WebView2 ni
    /// ninguna página web dentro. La ventana habla con el motor por la API local,
    /// que es la misma que usaba la interfaz web de antes.
    /// </summary>
    internal sealed class VentanaPrincipal : Form
    {
        private readonly Api api;
        private readonly Nucleo nucleo;
        private readonly int puerto;
        private readonly Portadas portadas;
        private readonly Panel contenido;
        private readonly Label titulo;
        private readonly Label aviso;
        private readonly Label pie;
        private readonly List<BotonLateral> botones = new List<BotonLateral>();
        private readonly System.Windows.Forms.Timer vigilancia;
        private VistaBiblioteca biblioteca;
        private VistaBuscar buscar;
        private VistaActividad actividad;
        private VistaEstadisticas estadisticas;
        private VistaAjustes ajustes;
        private UserControl vistaActual;
        private string vistaActiva = "biblioteca";

        public VentanaPrincipal(Api api, Nucleo nucleo, int puerto, string version, string carpetaDatos)
        {
            this.api = api;
            this.nucleo = nucleo;
            this.puerto = puerto;

            Text = "Nébula " + version;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 800);
            MinimumSize = new Size(1000, 640);
            BackColor = Tema.Fondo;
            KeyPreview = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            portadas = new Portadas(api);

            /* ------------------------------------------------------- barra lateral */
            Panel lateral = new Panel();
            lateral.Dock = DockStyle.Left;
            lateral.Width = 232;
            lateral.BackColor = Tema.Panel;
            lateral.Padding = new Padding(12, 18, 12, 12);

            Panel marca = new Panel();
            marca.Dock = DockStyle.Top;
            marca.Height = 74;
            marca.BackColor = Color.Transparent;
            Label nombre = Tema.Etiqueta("Nébula", Tema.Titulo, Color.White);
            nombre.Location = new Point(6, 0);
            Label sub = Tema.Etiqueta("tu biblioteca de juegos", Tema.Pequena, Tema.Suave);
            sub.Location = new Point(8, 38);
            marca.Controls.Add(nombre);
            marca.Controls.Add(sub);

            Panel navegacion = new Panel();
            navegacion.Dock = DockStyle.Top;
            navegacion.Height = 240;
            navegacion.BackColor = Color.Transparent;

            /* se añaden de abajo arriba: Dock.Top apila en orden inverso */
            BotonLateral botonAjustes = CrearBoton("Ajustes", "ajustes");
            BotonLateral botonEstadisticas = CrearBoton("Estadísticas", "estadisticas");
            BotonLateral botonActividad = CrearBoton("Actividad", "actividad");
            BotonLateral botonBuscar = CrearBoton("Buscar juegos", "buscar");
            BotonLateral botonBiblioteca = CrearBoton("Biblioteca", "biblioteca");
            navegacion.Controls.Add(botonAjustes);
            navegacion.Controls.Add(botonEstadisticas);
            navegacion.Controls.Add(botonActividad);
            navegacion.Controls.Add(botonBuscar);
            navegacion.Controls.Add(botonBiblioteca);

            Panel inferior = new Panel();
            inferior.Dock = DockStyle.Bottom;
            inferior.Height = 92;
            inferior.BackColor = Color.Transparent;
            pie = Tema.Etiqueta("Conectando con el motor…", Tema.Pequena, Tema.Suave);
            pie.Dock = DockStyle.Top;
            pie.Height = 34;
            Label versionLabel = Tema.Etiqueta("versión " + version + " · interfaz nativa", Tema.Pequena, Tema.Suave);
            versionLabel.Dock = DockStyle.Top;
            versionLabel.Height = 20;
            Label carpetaLabel = Tema.Etiqueta("datos: " + carpetaDatos, Tema.Pequena, Color.FromArgb(0x5C, 0x62, 0x78));
            carpetaLabel.Dock = DockStyle.Top;
            carpetaLabel.Height = 20;
            carpetaLabel.AutoEllipsis = true;
            inferior.Controls.Add(carpetaLabel);
            inferior.Controls.Add(versionLabel);
            inferior.Controls.Add(pie);

            lateral.Controls.Add(inferior);
            lateral.Controls.Add(navegacion);
            lateral.Controls.Add(marca);

            /* ------------------------------------------------------------- cabecera */
            Panel cabecera = new Panel();
            cabecera.Dock = DockStyle.Top;
            cabecera.Height = 66;
            cabecera.BackColor = Tema.Fondo;
            cabecera.Padding = new Padding(20, 16, 20, 8);

            titulo = Tema.Etiqueta("Biblioteca", Tema.Subtitulo);
            titulo.Location = new Point(20, 16);

            Panel acciones = new Panel();
            acciones.Dock = DockStyle.Right;
            acciones.Width = 470;
            acciones.BackColor = Color.Transparent;

            Button todo = Tema.Boton("Detener todo", false, 130);
            todo.Location = new Point(330, 12);
            todo.Click += async (s, e) => await DetenerTodo();
            Button actualizar = Tema.Boton("Actualizar", true, 120);
            actualizar.Location = new Point(200, 12);
            actualizar.Click += async (s, e) => await Recargar(true);

            aviso = Tema.Etiqueta(string.Empty, Tema.Pequena, Tema.Suave);
            aviso.Location = new Point(0, 18);
            aviso.Width = 190;
            aviso.TextAlign = ContentAlignment.MiddleRight;
            aviso.AutoSize = false;
            aviso.Height = 22;

            acciones.Controls.Add(aviso);
            acciones.Controls.Add(actualizar);
            acciones.Controls.Add(todo);
            cabecera.Controls.Add(acciones);
            cabecera.Controls.Add(titulo);

            /* ---------------------------------------------------------- contenido */
            contenido = new Panel();
            contenido.Dock = DockStyle.Fill;
            contenido.BackColor = Tema.Fondo;
            contenido.Padding = new Padding(20, 4, 20, 18);

            Controls.Add(contenido);
            Controls.Add(cabecera);
            Controls.Add(lateral);

            /* ------------------------------------------------- vigilancia del motor */
            vigilancia = new System.Windows.Forms.Timer();
            vigilancia.Interval = 4000;
            vigilancia.Tick += async (s, e) => await Latido();
            vigilancia.Start();

            KeyDown += Atajos;
            Shown += async (s, e) => await CargarInicial();
        }

        private BotonLateral CrearBoton(string texto, string clave)
        {
            BotonLateral boton = new BotonLateral(texto);
            boton.Tag = clave;
            boton.Click += async (s, e) => await Ir((string)((Control)s).Tag);
            botones.Add(boton);
            return boton;
        }

        private async Task CargarInicial()
        {
            /* el motor tarda un par de segundos en abrir su puerta: se espera con
               calma (hasta 15 s) en vez de enseñar una biblioteca vacía por error */
            pie.Text = "Conectando con el motor…";
            pie.ForeColor = Tema.Suave;
            for (int intento = 0; intento < 60; intento++)
            {
                try
                {
                    await api.EstadoAsync();
                    break;
                }
                catch
                {
                    await Task.Delay(250);
                }
            }
            await Ir("biblioteca");
            await Latido();
        }

        /* -------------------------------------------------------------- navegación */

        private async Task Ir(string clave)
        {
            vistaActiva = clave;
            foreach (BotonLateral boton in botones)
            {
                boton.Activo = string.Equals(boton.Tag as string, clave, StringComparison.Ordinal);
            }

            UserControl vista = ObtenerVista(clave);
            if (vista == null) return;

            if (vistaActual != null && vistaActual != vista) vistaActual.Visible = false;
            if (!contenido.Controls.Contains(vista))
            {
                vista.Dock = DockStyle.Fill;
                contenido.Controls.Add(vista);
            }
            vista.Visible = true;
            vista.BringToFront();
            vistaActual = vista;

            switch (clave)
            {
                case "biblioteca": titulo.Text = "Biblioteca"; break;
                case "buscar": titulo.Text = "Buscar juegos"; break;
                case "actividad": titulo.Text = "Actividad"; break;
                case "estadisticas": titulo.Text = "Estadísticas"; break;
                default: titulo.Text = "Ajustes"; break;
            }
            Avisar(string.Empty);
            await Recargar(false);
        }

        private UserControl ObtenerVista(string clave)
        {
            if (clave == "biblioteca")
            {
                if (biblioteca == null)
                {
                    biblioteca = new VistaBiblioteca(api, portadas);
                    biblioteca.Aviso += Avisar;
                    biblioteca.AbrirJuego += AbrirJuego;
                }
                return biblioteca;
            }
            if (clave == "buscar")
            {
                if (buscar == null)
                {
                    buscar = new VistaBuscar(api);
                    buscar.Aviso += Avisar;
                }
                return buscar;
            }
            if (clave == "actividad")
            {
                if (actividad == null)
                {
                    actividad = new VistaActividad(api);
                    actividad.Aviso += Avisar;
                }
                return actividad;
            }
            if (clave == "estadisticas")
            {
                if (estadisticas == null)
                {
                    estadisticas = new VistaEstadisticas(api);
                    estadisticas.Aviso += Avisar;
                }
                return estadisticas;
            }
            if (ajustes == null)
            {
                ajustes = new VistaAjustes(api);
                ajustes.Aviso += Avisar;
            }
            return ajustes;
        }

        private async Task Recargar(bool renovarCaratulas)
        {
            try
            {
                UseWaitCursor = true;
                if (vistaActiva == "biblioteca" && biblioteca != null) await biblioteca.RecargarAsync(renovarCaratulas);
                else if (vistaActiva == "buscar" && buscar != null) await buscar.RecargarAsync();
                else if (vistaActiva == "actividad" && actividad != null) await actividad.RecargarAsync();
                else if (vistaActiva == "estadisticas" && estadisticas != null) await estadisticas.RecargarAsync();
                else if (vistaActiva == "ajustes" && ajustes != null) await ajustes.RecargarAsync();
            }
            catch (Exception error)
            {
                Avisar("No se pudo actualizar: " + error.Message);
            }
            finally
            {
                UseWaitCursor = false;
                if (renovarCaratulas && vistaActiva == "biblioteca") Avisar("Carátulas actualizadas");
            }
        }

        /* ------------------------------------------------------------------ ficha */

        private async void AbrirJuego(Juego juego)
        {
            if (juego == null) return;
            List<EstadoJuego> estados = new List<EstadoJuego>();
            try
            {
                JToken estado = await api.EstadoAsync();
                if (estado != null) estados = EstadoJuego.Desde(estado["statuses"]);
            }
            catch { /* se abre la ficha con lo que se tenga */ }

            using (DialogoJuego dialogo = new DialogoJuego(api, juego, estados))
            {
                dialogo.ShowDialog(this);
                if (dialogo.Cambio) await Recargar(false);
            }
        }

        /* ------------------------------------------------------------- vigilancia */

        private async Task Latido()
        {
            HashSet<string> ids = new HashSet<string>();
            try
            {
                JToken launcher = await api.LauncherAsync();
                JToken sesiones = launcher == null ? null : launcher["sessions"];
                if (sesiones is JObject)
                {
                    foreach (JProperty propiedad in ((JObject)sesiones).Properties()) ids.Add(propiedad.Name);
                }
                pie.Text = ids.Count > 0
                    ? "Motor en marcha · " + ids.Count + (ids.Count == 1 ? " juego abierto" : " juegos abiertos")
                    : "Motor en marcha";
                pie.ForeColor = ids.Count > 0 ? Tema.Verde : Tema.Suave;
                if (biblioteca != null) biblioteca.MarcarEnMarcha(ids);
            }
            catch
            {
                pie.Text = nucleo != null && nucleo.Vivo ? "El motor no responde" : "Motor detenido";
                pie.ForeColor = Tema.Amarillo;
            }
        }

        private async Task DetenerTodo()
        {
            try
            {
                await api.DetenerTodoAsync();
                Avisar("Juegos detenidos");
                await Recargar(false);
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Nébula", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private async void Atajos(object remitente, KeyEventArgs e)
        {
            if (e.Control && e.KeyCode == Keys.F)
            {
                if (vistaActiva != "biblioteca") await Ir("biblioteca");
                if (biblioteca != null) biblioteca.EnfocarBusqueda();
                e.SuppressKeyPress = true;
                return;
            }
            if (e.KeyCode == Keys.F5)
            {
                await Recargar(true);
                e.SuppressKeyPress = true;
                return;
            }
            if (e.Control && e.KeyCode == Keys.D1) { await Ir("biblioteca"); e.SuppressKeyPress = true; }
            else if (e.Control && e.KeyCode == Keys.D2) { await Ir("buscar"); e.SuppressKeyPress = true; }
            else if (e.Control && e.KeyCode == Keys.D3) { await Ir("actividad"); e.SuppressKeyPress = true; }
            else if (e.Control && e.KeyCode == Keys.D4) { await Ir("estadisticas"); e.SuppressKeyPress = true; }
            else if (e.Control && e.KeyCode == Keys.D5) { await Ir("ajustes"); e.SuppressKeyPress = true; }
        }

        private void Avisar(string texto)
        {
            aviso.Text = texto ?? string.Empty;
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            vigilancia.Stop();
            base.OnFormClosed(e);
        }
    }
}
