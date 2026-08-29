import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

let configuredKey = null

export function configureGoogleMaps(apiKey) {
  if (!configuredKey) {
    setOptions({ key: apiKey, v: 'weekly' })
    configuredKey = apiKey
  }
  return importLibrary
}
