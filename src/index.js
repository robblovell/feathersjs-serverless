const Proto = require('uberproto')
const getService = require('./get-service')
const getArgs = require('./get-args')
const { getFeathersMethod } = require('./methods')

const parse = (target, options = { parseNull: true, parseUndefined: true, parseBoolean: true, parseNumber: true }) => {
  switch (typeof (target)) {
    case 'string':
      if (target === '') {
        return ''
      } else if (options.parseNull && target === 'null') {
        return null
      } else if (options.parseUndefined && target === 'undefined') {
        return undefined
      } else if (options.parseBoolean && (target === 'true' || target === 'false')) {
        return target === 'true'
      } else if (options.parseNumber && !isNaN(Number(target))) {
        return Number(target)
      } else {
        return target
      }
    case 'object':
      if (Array.isArray(target)) {
        return target.map(x => parse(x, options))
      } else {
        const obj = target
        for (const key of Object.keys(obj)) {
          obj[key] = parse(target[key], options)
        }
        return obj
      }
    default:
      return target
  }
}
const getKey = (key) => {
  return key.split('[')[0]
}

const fixParameter = (key, value) => {
  if (!key.includes('[]') && key.includes('[') && key.includes(']')) {
    const elements = key.split('[')
    const newSubKey = elements[1].split(']')[0]
    return fixQueryParameters2({ [newSubKey]: parse(value) })
  } else if (Array.isArray(value) && value.length === 1) {
    return parse(value[0])
  } else if (key.includes('[]')) {
    const elements = key.split('[')
    if (elements.length === 2) {
      return parse(value)
    } else {
      const newSubKey = key.split('[')[1].split(']')[0]
      return fixQueryParameters2({ [newSubKey]: value })
    }
  } else {
    return parse(value)
  }
}
const fixQueryParameters2 = (parameters) => {
  const query = {}
  if (!parameters) {
    return query
  }
  const keys = Object.keys(parameters)
  for (const key of keys) {
    query[getKey(key)] = fixParameter(key, parameters[key])
  }
  return query
}

module.exports = feathersApp => {
  const mixin = {
    set (key, value) {
      if (!this.variables) {
        this.variables = {}
      }

      Object.assign(this.variables, {
        [key]: value
      })

      return this
    },

    get (key) {
      return this.variables[key]
    },

    setup (func) {
      this.setupFunc = func
      return this
    },

    handler () {
      const self = this
      self.emit('handlerstarted')
      return async (event, context, cb) => {
        if (!self.setupPromise) {
          self.setupPromise = (typeof self.setupFunc === 'function')
            ? self.setupFunc(self)
            : Promise.resolve()
        }

        await self.setupPromise

        // Extract the path from the event.
        const {
          path,
          httpMethod: method,
          body: bodyAsString
        } = event

        const query = fixQueryParameters2(event.multiValueQueryStringParameters)
        const body = bodyAsString
          ? JSON.parse(bodyAsString)
          : {}

        const { service: serviceName, feathersId } = getService(self, path)

        if (!serviceName || !self.service(serviceName)) {
          return cb(null, {
            statusCode: 404,
            body: JSON.stringify({ error: `Service not found: ${path}` })
          })
        }

        const service = self.service(serviceName)
        const feathersMethod = getFeathersMethod(method, feathersId)

        if (!feathersMethod || !service[feathersMethod]) {
          return cb(null, {
            statusCode: 404,
            body: JSON.stringify({ error: `Method not allowed: ${method}` })
          })
        }

        const args = getArgs(feathersMethod, { query, feathersId, body })
        return service[feathersMethod](...args)
          .then(data => {
            return cb(null, {
              body: JSON.stringify({ data })
            })
          })
          .catch(e => {
            return cb(null, {
              statusCode: e.code || 500,
              body: JSON.stringify({ error: e.message })
            })
          })
      }
    }
  }

  return Proto.mixin(mixin, feathersApp)
}
