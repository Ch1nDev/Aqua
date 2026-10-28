// Throwaway probe: can we still list Bedrock versions and resolve package URLs?
const UWP_LISTS = [
  'https://mrarm.io/r/w10-vdb',
  'https://raw.githubusercontent.com/ddf8196/mc-w10-versiondb-auto-update/master/versions.json.min',
]
const GDK_LIST = 'https://raw.githubusercontent.com/MinecraftBedrockArchiver/GdkLinks/refs/heads/master/urls.min.json'
const SOAP_URL = 'https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx'

async function get(url, options) {
  const response = await fetch(url, options)
  return { status: response.status, text: await response.text() }
}

function soapEnvelope(updateId) {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header><a:Action>http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService/GetExtendedUpdateInfo2</a:Action><a:MessageID>urn:uuid:0ffc5961-414a-4019-9c0f-9247281674d4</a:MessageID><a:To s:mustUnderstand="1">https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx</a:To><o:Security s:mustUnderstand="1" xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wuws:WindowsUpdateTicketsToken wsu:id="ClientMSA" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" xmlns:wuws="http://schemas.microsoft.com/msus/2014/10/WindowsUpdateAuthorization"><TicketType Name="AAD" Version="1.0" Policy="MBI_SSL"></TicketType></wuws:WindowsUpdateTicketsToken></o:Security></s:Header><s:Body><GetExtendedUpdateInfo2 xmlns="http://www.microsoft.com/SoftwareDistribution/Server/ClientWebService"><updateIDs><UpdateIdentity><UpdateID>${updateId}</UpdateID><RevisionNumber>1</RevisionNumber></UpdateIdentity></updateIDs><infoTypes><XmlUpdateFragmentType>FileUrl</XmlUpdateFragmentType></infoTypes></GetExtendedUpdateInfo2></s:Body></s:Envelope>`
}

const report = {}

for (const url of UWP_LISTS) {
  try {
    const { status, text } = await get(url)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    report[url] = {
      status,
      bytes: text.length,
      isArray: Array.isArray(parsed),
      count: Array.isArray(parsed) ? parsed.length : null,
      first: Array.isArray(parsed) ? parsed[0] : text.slice(0, 200),
      last: Array.isArray(parsed) ? parsed[parsed.length - 1] : null,
    }
  } catch (error) {
    report[url] = { error: error.message }
  }
}

try {
  const { status, text } = await get(GDK_LIST)
  const parsed = JSON.parse(text)
  const releases = Object.keys(parsed.release || {})
  const previews = Object.keys(parsed.preview || {})
  report[GDK_LIST] = {
    status,
    releaseCount: releases.length,
    previewCount: previews.length,
    newestRelease: releases.slice(-3),
    newestPreview: previews.slice(-3),
    sampleUrl: parsed.release?.[releases[releases.length - 1]]?.[0] || null,
  }
} catch (error) {
  report[GDK_LIST] = { error: error.message }
}

// Resolve one UWP-era package through Microsoft's update service.
const probeIds = process.argv.slice(2)
for (const id of probeIds) {
  const started = Date.now()
  try {
    const { status, text } = await get(SOAP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
      body: soapEnvelope(id),
    })
    const urls = [...text.matchAll(/https?:\/\/[^\s<"]+/g)].map((match) => match[0])
    const tlu = urls.filter((url) => url.startsWith('http://tlu.dl'))
    report[`soap:${id}`] = {
      status,
      ms: Date.now() - started,
      bytes: text.length,
      urlCount: urls.length,
      tluCount: tlu.length,
      sample: tlu[0] || urls.slice(0, 3),
      head: text.slice(0, 400),
    }
  } catch (error) {
    report[`soap:${id}`] = { error: error.message }
  }
}

console.log(JSON.stringify(report, null, 2))
