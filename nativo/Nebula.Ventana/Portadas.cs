using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Threading.Tasks;

namespace Nebula.Ventana
{
    /// <summary>
    /// Carátulas en memoria.
    ///
    /// Cada tarjeta pide su carátula al motor; aquí se guardan para no volver a
    /// descargarlas al filtrar o al cambiar de vista. No se liberan al vaciar la
    /// caché a propósito: puede haber tarjetas usándolas en ese mismo instante, y
    /// liberar una imagen en uso tumba el programa. El recolector se encarga
    /// cuando ya nadie las mira.
    /// </summary>
    internal sealed class Portadas
    {
        private readonly Api api;
        private readonly ConcurrentDictionary<string, Task<Image>> cache = new ConcurrentDictionary<string, Task<Image>>();
        private int generacion;

        public Portadas(Api api)
        {
            this.api = api;
        }

        /// <summary>Vacía la caché para que se vuelvan a pedir (tras cambiar carátulas).</summary>
        public void Renovar()
        {
            generacion++;
            cache.Clear();
        }

        public Task<Image> ObtenerAsync(string id)
        {
            if (string.IsNullOrEmpty(id)) return Task.FromResult<Image>(null);
            string clave = generacion + ":" + id;
            return cache.GetOrAdd(clave, (k) => CargarAsync(id));
        }

        private async Task<Image> CargarAsync(string id)
        {
            try
            {
                return await api.PortadaAsync(id).ConfigureAwait(false);
            }
            catch
            {
                return null;   /* sin carátula: la tarjeta dibuja su hueco */
            }
        }
    }
}
