export const monthOptions = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? '00' : '30'

  return `${String(hour).padStart(2, '0')}:${minute}`
})

export const kharkivDefaults = {
  latitude: 49.9935,
  longitude: 36.2304,
}
